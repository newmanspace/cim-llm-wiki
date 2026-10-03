---
name: code
description: >
  按照已通过评审的设计方案进行编码，附带 TDD 测试约束。
  不负责代码审查（交由 code-review）和架构设计（交由 design）。
---
# 代码实现 (Code)

本技能负责将经过评审通过的设计方案，转化为符合项目全部红线约束的生产级代码与配套测试用例。

## 编码前置约束
在正式输出代码前，必须完成以下准备：
1. **技术栈探查**：自动读取 `pyproject.toml` 或类似环境清单，精准确认当前可用的库版本与依赖语法。
2. **微观细节确认**：向用户主动提出至少 1 个关于实现策略的判定问题（例如：某个特定三方库的使用倾向），**等到确认后才准全面动笔**。

## 开发红线约束
进入编写阶段后，严格遵循以下纪律：
1. **强制英文输出**：所有生成的 Python 业务代码、类名、docstring 注释、Exception 消息和日志打印，**全部使用纯英文**。
   - **例外**: Skill 文档 (`.agents/skills/*/SKILL.md`) 使用中文，便于 AI 理解
   - **禁止中文注释**：代码中的注释必须使用英文
2. **TDD 保障**：除业务文件外，必须随附基于 `pytest` 与 `pytest-asyncio` 的自动化测试用例，保障覆盖率达标。
3. **环境隔离**：代码中严禁硬编码任何数据库凭证或上游 API URL，一律从环境变量读取。
4. **提交静默**：本技能的职责止步于代码产出，**绝对不会也不被允许**执行 `git commit`。
5. **代码美学与质量**：编码完成后，所有 Python 文件**必须**位于顶部统一引入 Imports 并在本地执行并通过 `ruff check --fix` 修复后产出最终版本。
6. **DRY 原则**：当同一段逻辑在代码中出现 **2 次或以上** 时，必须提取为独立函数或工具方法。在写第二遍相似代码时，立即停下来思考是否可以复用。
7. **工具函数复用**：优先使用已有的工具函数，禁止复制粘贴重复实现。

## Code Reuse & DRY Principle

> 完整的 DRY 原则与分层职责规范，请参阅 `.agents/RULES.md` 中的「代码复用与 DRY 原则」章节。以下仅保留编码时的快速参考示例。

### Docstring Example
```python
def _calculate_next_scheduled_time(
    schedule_type: str,
    scheduled_time: str | None = None,
    now: datetime | None = None,
) -> datetime:
    """Calculate next scheduled time based on schedule type.

    Args:
        schedule_type: One of 'daily', 'weekly', 'monthly'
        scheduled_time: Time in HH:MM format (default: '09:00')
        now: Current datetime (default: datetime.now())

    Returns:
        Next scheduled time
    """
```

### Anti-Pattern (Repository 层包含业务逻辑)
```python
class SomeRepository:
    def _do_business_logic(...):  # ❌ 业务逻辑不应在这里
        ...
```

### Best Practice (业务逻辑在 Service 层)
```python
def _do_business_logic(...) -> SomeType:
    """Do business logic."""
    ...

class SomeService:
    def process_something(self, item_id: str):
        item = self.repo.get_item(item_id)
        result = _do_business_logic(item)
        self.repo.update_item(item_id, result)
```
