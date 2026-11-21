# 本地文件、图片和附件传输

原稿、解析稿和候选保存在 Agent 本机，通过 API 传输。服务连接使用环境中的 CIM_WIKI_URL、CIM_WIKI_TOKEN，URL 只填服务 origin；令牌不进入 URL、业务 JSON 或输出。

## 1. 原稿上传、解析与下载

### 1.1 推荐：使用 Skill 客户端

先设置 SKILL 为安装目录的绝对路径。以下 example-project、产品、版本、分类和文件路径须替换为本次任务真实值；输出文件和下载目录必须不存在。

convert-metadata.json 示例：

```json
{
  "project": "example-project",
  "system": "实际产品标识",
  "version": "实际产品版本",
  "category": "实际资料分类"
}
```

```bash
node "$SKILL/scripts/client.mjs" convert \
  --json-file /local/work/convert-metadata.json \
  --file /local/original/design.docx \
  --download-dir /local/work/parsed-v1 \
  --output /local/work/convert-response.json
```

此命令先以二进制上传原稿，再用上传 URI 调用 convert，最后逐文件下载解析包并验证摘要。不要为这条命令再手工包一层表单。服务返回 document、markdown、parsed_uri、parsed_sha256、package_sha256、entry、files；document.doc_id 是解析来源登记标识，**不是** source_version_id。

### 1.2 接口与回执

所有路径前缀为 `/api/v2/knowledge`，使用 `Authorization: Bearer $CIM_WIKI_TOKEN`。

| 请求 | Content-Type 与请求体 | 返回及后续用途 |
| --- | --- | --- |
| POST /upload?project=ID&filename=NAME | application/octet-stream；请求体为文件原始字节 | 顶层 uri、filename、sha256、size、media_type；uri 为 uploaded://… |
| POST /convert | application/json；project、system、version、category、source=上传回执 uri，可选 engine | 顶层 document、parsed_uri 和解析包清单；用于下载及提交关联 |
| POST /document-packages | application/json；project、entry、files；每个 file 含 path、上传 uri、sha256 | 顶层 uri=document-package://…、package_sha256、entry、files |
| POST /register | application/json；project、system、version、category、source=原稿包 URI，可选 parsed=已有解析包 URI | 来源登记与解析包清单；不调用解析引擎 |
| GET /document-packages?project=ID&uri=包URI | 无请求体 | 完整包清单；不是附件文件内容 |
| GET /uploads/content?project=ID&uri=上传URI | 无请求体 | 原始文件字节，须核对大小及 sha256 |

JSON 写请求发送稳定的 Idempotency-Key。上传按文件名及实际字节摘要去重，不需要预先生成上传幂等键。project、filename、uri 查询参数须 URL 编码。不要将整份 upload 回执或本机路径作为 convert.source。

### 1.3 直接调用 HTTP：完整上传与解析示例

只在需要手动调用接口时采用此路径，与 1.1 的自动上传二选一。需要 curl（支持 --fail-with-body）和 Node.js。先准备 1.1 所示的真实 convert 元数据文件，并将变量替换为实际值：

```bash
export CIM_SOURCE_FILE='/local/original/design.docx'
export CIM_CONVERT_METADATA='/local/work/convert-metadata.json'
umask 077
export CIM_WORK_DIR="$(mktemp -d)"
```

以下代码依次上传、生成 convert 请求、解析并下载；任何 HTTP 失败均停止，不把错误 JSON 当成成功回执。临时目录中无凭据文件；令牌始终从环境读取。

```bash
set -eu
UPLOAD_QUERY="$(node --input-type=module <<'JS'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
const meta = JSON.parse(readFileSync(process.env.CIM_CONVERT_METADATA, 'utf8'))
console.log(new URLSearchParams({ project: meta.project, filename: basename(process.env.CIM_SOURCE_FILE) }).toString())
JS
)"
curl --silent --show-error --fail-with-body --max-time 900 \
  -H "Authorization: Bearer $CIM_WIKI_TOKEN" \
  -H 'Content-Type: application/octet-stream' \
  --data-binary "@$CIM_SOURCE_FILE" \
  --output "$CIM_WORK_DIR/upload.json" \
  "${CIM_WIKI_URL%/}/api/v2/knowledge/upload?$UPLOAD_QUERY"

node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const meta = JSON.parse(readFileSync(process.env.CIM_CONVERT_METADATA, 'utf8'))
const uploaded = JSON.parse(readFileSync(join(process.env.CIM_WORK_DIR, 'upload.json'), 'utf8'))
if (!/^uploaded:\/\/[a-f0-9]{64}$/.test(uploaded.uri)) throw new Error('Invalid upload receipt')
writeFileSync(join(process.env.CIM_WORK_DIR, 'convert-request.json'),
  JSON.stringify({ ...meta, source: uploaded.uri }), { mode: 0o600, flag: 'wx' })
JS
CONVERT_KEY="$(node --input-type=module <<'JS'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
console.log('convert-' + createHash('sha256').update(readFileSync(process.env.CIM_WORK_DIR + '/convert-request.json')).digest('hex'))
JS
)"
curl --silent --show-error --fail-with-body --max-time 900 \
  -H "Authorization: Bearer $CIM_WIKI_TOKEN" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $CONVERT_KEY" \
  --data-binary "@$CIM_WORK_DIR/convert-request.json" \
  --output "$CIM_WORK_DIR/convert-response.json" \
  "${CIM_WIKI_URL%/}/api/v2/knowledge/convert"

PARSED_URI="$(node --input-type=module <<'JS'
import { readFileSync } from 'node:fs'
const result = JSON.parse(readFileSync(process.env.CIM_WORK_DIR + '/convert-response.json', 'utf8'))
if (!result.parsed_uri?.startsWith('document-package://')) throw new Error('Missing parsed package')
console.log(result.parsed_uri)
JS
)"
PROJECT_ID="$(node --input-type=module <<'JS'
import { readFileSync } from 'node:fs'
console.log(JSON.parse(readFileSync(process.env.CIM_CONVERT_METADATA, 'utf8')).project)
JS
)"
node "$SKILL/scripts/client.mjs" download-package \
  --project "$PROJECT_ID" --source "$PARSED_URI" \
  --download-dir "$CIM_WORK_DIR/parsed" --output "$CIM_WORK_DIR/download.json"
```

`--data-binary @文件` 把文件字节作为请求体；不要使用 curl `-F`、FormData、multipart/form-data 或自己添加 Content-Disposition／boundary。JSON 请求中的 source 引用 upload.json.uri；解析输出从 convert-response.json.parsed_uri 下载。解析成功但下载失败时，保留回执并用 download-package 重试，无需重新解析。

### 1.4 已有 Markdown 与附件

原稿已是 Markdown 时，保留相对附件并直接上传原稿包，不调用解析器：

```bash
node "$SKILL/scripts/client.mjs" register \
  --json-file /local/work/register-metadata.json \
  --package-root /local/original --entry document.md \
  --output /local/work/register-response.json
```

register-metadata.json 的字段与 1.1 相同。快捷入口将原稿包同时作为解析基线；候选另存，不覆盖原稿。若已有合法解析包，可直接向 register 发送 1.2 所列 JSON，以 source 和 parsed 分别关联真实原稿与解析稿。不能把候选重新登记成原件。

## 2. 本地候选包与检查

候选入口可为 document.md，图片、附件用相对路径引用，例如 `![流程图](assets/flow.png)`、`[功能清单](attachments/list.xlsx)`。包根下保留所有依赖；入口也可位于 doc/code 子目录。工具递归解析 Markdown 依赖，忽略代码示例，拒绝缺失文件、符号链接、越界及大小写冲突。

```bash
node "$SKILL/scripts/ingest.mjs" \
  --rules /local/work/project-rules.json \
  --json-file /local/work/candidate-metadata.json \
  --root /local/work/candidate --document document.md \
  --output /local/work/report.json
```

规则来自当前项目 templates 完整响应。元数据含 project、实际 template_id（无专门模板省略）、target_path、可选 document_id、identity 和 fidelity；正文从本地文件读取。报告包含正文哈希、package_manifest、package_sha256 和 errors/warnings。修改正文、附件、身份或路径后重跑。没有身份仅为 warning；Agent 对照原稿后才能声明 fidelity=checked。

PNG/JPEG/GIF/WebP 可预览；SVG 及其他附件只下载。远程图片未归档为 warning，不自动抓取，也不把未验证项记为通过。

## 3. 上传候选并提交

```bash
node "$SKILL/scripts/client.mjs" submit \
  --json-file /local/work/submit.json \
  --package-root /local/work/candidate --entry document.md \
  --report /local/work/report.json --output /local/work/submit-response.json
```

submit.json 字段及草稿／冻结流程唯一说明见[文档结果处理](document-quality.md)。来源使用 convert/register 的 document.doc_id 作为 parsed_source_id；source_links 使用真实 observation.id，二者不能混用。客户端自动补充候选 content_uri 和 local_report，并核验检查后的包未变化。

submit 成功即在文档结果列表可见，不依赖 freeze、review 或 compile。草稿用 save-draft，不自动转为正式提交。上传、封装、解析登记、来源观测和文档提交是不同完成状态。使用 --output 时，阶段上传／封装回执在 `<输出文件>.receipts/`，最终响应在输出文件。HTTP 错误均报告真实状态；自动传输阶段的错误在 stderr 中，不能假定最终文件必然存在。

## 4. 来源证据与运行状态

已配置仓库的项目使用 git-source/svn-source 采集器自动登记 run 和 observation，读取输出的 run_id、source_version_id、source_uri。已有 Markdown 复用 source_package_uri 和 package_source_links。不要为了换一个 running run 而丢弃既有来源关联；对应观测必须与该批次来源和固定版本相符。

`upload` 只创建 uploaded:// 对象，convert/register 只建立原稿与解析稿关系；它们都不自动产生 source_version_id。uploaded:// **可以作为 observation.original_uri**，但不能直接填入 source_links.source_version_id。使用以下命令核对实际观测回执：

```bash
node "$SKILL/scripts/client.mjs" list-source-observations --project <project-id>
node "$SKILL/scripts/client.mjs" list-ingest-runs --project <project-id>
```

source_links 中引用 observation 的 id。新增 observation 还需要 running 状态的 run、真实 repository_path、original_uri、original_sha256，以及 Git/SVN 的固定版本证据；不要手工伪造仓库证据。字段见[来源登记](document-quality.md#来源登记与批次)。

仅完全没有仓库文档源配置的项目可使用 local_file：先创建 `{project,source_type:"local_file",recipe_version}` 运行，再登记 `{project,run_id,repository_path,original_uri,original_sha256}`。原稿为包时 original_sha256 使用 register 返回的 document.original_sha256，完整包由 URI 固定。存在仓库配置的项目不能改用 local_file 绕过证据要求。

## 5. 限制、错误与重试

| 状态 | 处理 |
| --- | --- |
| 401/403 | 核对 Agent 凭据和操作权限，不切换为人工审核令牌 |
| 404 | 核对项目、资源 URI 和登记 ID，不更换文档身份取号绕过 |
| 409 | 按具体错误核对本地报告、版本、项目规则或来源关联；修正后重新检查 |
| 413 | 服务端拒绝大小超限；不截断文件、不自动调整配置 |
| 415 / UPLOAD_CONTENT_TYPE_UNSUPPORTED | 改为原始字节上传，不换扩展名、不重复发送同一表单 |
| 422 | 读取具体错误码；LOCAL_INGEST_REPORT_INVALID 表示报告含 errors 或结构非法，不是要求重跑服务端模板检查 |
| 超时或断连 | 先查已有回执和结果；确需重试时保留相同内容与幂等键，输出改用新路径；不自动无限重试 |

客户端不读取上传上限，单文件及包总量由服务端配置；Markdown 4 MiB、200 文件和路径安全约束仍存在。下载只按回执声明的大小和摘要核验。上传 URI 不是权限凭证，不可跨项目读写。

已经混入表单头的错误对象不能原地改写：从本机干净原稿／候选重新上传正确对象及包；若解析登记也引用了错误对象，则重新登记正确的原稿与解析稿关系。保留真实原始 PPTX/PDF 等原稿，不把候选替代原稿。最后重跑本地 ingest，并让提交请求及报告指向同一组新回执。

submit 复用服务器原稿登记元数据，不重新读取原稿计算哈希；freeze 仍检查服务器留存的原稿、解析稿、候选及附件。两者是不同阶段，不能把取消 submit 的原稿复核理解为取消冻结校验。
