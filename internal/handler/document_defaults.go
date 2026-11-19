package handler

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"cim-llm-wiki/internal/observability"
	"cim-llm-wiki/internal/store"
	"github.com/gin-gonic/gin"
)

// DocumentDefaultsHandler forwards authenticated administrative requests to the
// document rules service. Service credentials never reach the browser.
type DocumentDefaultsHandler struct {
	Store  *store.Store
	URL    string
	Token  string
	Client *http.Client
}

func NewDocumentDefaultsHandler(repository *store.Store) *DocumentDefaultsHandler {
	return &DocumentDefaultsHandler{Store: repository, URL: strings.TrimRight(os.Getenv("CIM_WIKI_KNOWLEDGE_URL"), "/"), Token: os.Getenv("CIM_WIKI_LEDGER_TOKEN"), Client: &http.Client{Timeout: 30 * time.Second}}
}

func (h *DocumentDefaultsHandler) request(c *gin.Context, action string, payload []byte) ([]byte, int, error) {
	return h.requestTo(c, "/internal/document-defaults"+action, payload)
}

func (h *DocumentDefaultsHandler) requestTo(c *gin.Context, path string, payload []byte) ([]byte, int, error) {
	target := h.URL + path
	if c.Request.URL.RawQuery != "" {
		target += "?" + c.Request.URL.RawQuery
	}
	req, err := http.NewRequestWithContext(c.Request.Context(), c.Request.Method, target, bytes.NewReader(payload))
	if err != nil {
		return nil, 503, err
	}
	req.Header.Set("Authorization", "Bearer "+h.Token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Request-ID", c.GetHeader("X-Request-ID"))
	req.Header.Set("X-Settings-Actor", c.GetString("quality_actor"))
	response, err := h.Client.Do(req)
	if err != nil {
		return nil, 503, err
	}
	defer response.Body.Close()
	limit := 8 * 1024 * 1024
	if path == "/internal/document-result-original" {
		limit = 36 * 1024 * 1024
	}
	if path == "/internal/document-result-preview" {
		limit = 64 * 1024 * 1024
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, int64(limit)+1))
	if len(data) > limit {
		return nil, 503, io.ErrShortBuffer
	}
	return data, response.StatusCode, err
}

func (h *DocumentDefaultsHandler) Handle(c *gin.Context) {
	if h.URL == "" || len(h.Token) < 32 {
		observability.ReportFailure(c.Request.Context(), "project.templates", "TEMPLATE_SERVICE_UNCONFIGURED", "Document template service is not configured")
		c.JSON(503, gin.H{"error": "Document template service is not configured"})
		return
	}
	action := c.Param("action")
	allowed := map[string]bool{"": true, "save": true, "publish": true, "check": true, "render": true, "preview": true, "bind": true, "bind-naming": true, "bind-templates": true, "project": true}
	if !allowed[action] {
		c.JSON(404, gin.H{"error": "Unknown template operation"})
		return
	}
	if action != "" {
		action = "/" + action
	}
	var payload []byte
	var err error
	if c.Request.Method == http.MethodPost {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8*1024*1024)
		payload, err = io.ReadAll(c.Request.Body)
		if err != nil {
			c.JSON(413, gin.H{"error": "Request body too large"})
			return
		}
	}
	project := ""
	if (action == "/bind" || action == "/bind-naming" || action == "/bind-templates") && h.Store != nil {
		var ok bool
		project, ok = h.bindingProject(c, payload)
		if !ok {
			return
		}
	}
	data, status, err := h.request(c, action, payload)
	if err != nil {
		observability.ReportFailure(c.Request.Context(), "project.templates", "TEMPLATE_SERVICE_UNAVAILABLE", "Document template service unavailable")
		c.JSON(503, gin.H{"error": "Document template service unavailable"})
		return
	}
	if !h.finishBinding(c, data, status, action, project) {
		return
	}
	c.Data(status, "application/json", data)
}

// InitializeProject binds new projects to the published system contract.
func (h *DocumentDefaultsHandler) InitializeProject(c *gin.Context, projectID, name, version string, wikiSourceDirectory ...string) ([]map[string]string, error) {
	if h.URL == "" || len(h.Token) < 32 {
		return nil, templateError("Document template service is not configured")
	}
	input := gin.H{"project": projectID, "name": name, "product_version": version, "modules": []string{}}
	if len(wikiSourceDirectory) > 0 && wikiSourceDirectory[0] != "" {
		input["wiki_source_directory"] = wikiSourceDirectory[0]
	}
	payload, _ := json.Marshal(input)
	// Project initialization always uses the configured service origin.
	saved := c.Request.URL.RawQuery
	c.Request.URL.RawQuery = ""
	defer func() { c.Request.URL.RawQuery = saved }()
	data, status, err := h.request(c, "/bind", payload)
	if err != nil {
		return nil, err
	}
	if status != 200 {
		return nil, &url.Error{Op: "initialize document templates", URL: projectID, Err: templateError(string(data))}
	}
	return bindingDirectories(data)
}

// The ledger stores directory names; node type arrays remain in the template service.
func bindingDirectories(data []byte) ([]map[string]string, error) {
	var binding struct {
		Directories []struct {
			Path  string `json:"path"`
			Title string `json:"title"`
		} `json:"directories"`
	}
	if err := json.Unmarshal(data, &binding); err != nil {
		return nil, err
	}
	entries := make([]map[string]string, 0, len(binding.Directories))
	for _, directory := range binding.Directories {
		entries = append(entries, map[string]string{"path": directory.Path, "title": directory.Title})
	}
	return entries, nil
}

type templateError string

func (e templateError) Error() string { return string(e) }

func (h *DocumentDefaultsHandler) bindingProject(c *gin.Context, payload []byte) (string, bool) {
	var request struct {
		Project string `json:"project"`
	}

	if err := json.Unmarshal(payload, &request); err != nil {
		c.JSON(422, gin.H{"error": "Invalid project binding"})
		return "", false
	}
	if _, err := h.Store.GetProject(c.Request.Context(), request.Project); err != nil {
		c.JSON(404, gin.H{"error": "Project not found"})
		return "", false
	}
	return request.Project, true
}

func (h *DocumentDefaultsHandler) finishBinding(c *gin.Context, data []byte, status int, action, project string) bool {
	if status != 200 || action != "/bind" || h.Store == nil {
		return true
	}
	directories, err := bindingDirectories(data)
	if err != nil {
		observability.ReportFailure(c.Request.Context(), "project.templates", "TEMPLATE_SERVICE_INVALID_RESPONSE", "Invalid template service response")
		c.JSON(503, gin.H{"error": "Invalid template service response"})
		return false
	}
	if err := h.Store.EnsureDocumentDirectories(c.Request.Context(), project, directories); err != nil {
		observability.ReportFailure(c.Request.Context(), "project.templates", "PROJECT_DIRECTORY_SYNC_FAILED", "Project directories could not be synchronized; retry the binding")
		c.JSON(503, gin.H{"error": "Project directories could not be synchronized; retry the binding"})
		return false
	}
	return true
}
