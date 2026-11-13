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

func NewDocumentDefaultsHandler(stores ...*store.Store) *DocumentDefaultsHandler {
	var repository *store.Store
	if len(stores) > 0 {
		repository = stores[0]
	}
	return &DocumentDefaultsHandler{Store: repository, URL: strings.TrimRight(os.Getenv("CIM_WIKI_KNOWLEDGE_URL"), "/"), Token: os.Getenv("CIM_WIKI_LEDGER_TOKEN"), Client: &http.Client{Timeout: 30 * time.Second}}
}

func (h *DocumentDefaultsHandler) request(c *gin.Context, action string, payload []byte) ([]byte, int, error) {
	target := h.URL + "/internal/document-defaults" + action
	if c.Request.URL.RawQuery != "" {
		target += "?" + c.Request.URL.RawQuery
	}
	req, err := http.NewRequestWithContext(c.Request.Context(), c.Request.Method, target, bytes.NewReader(payload))
	if err != nil {
		return nil, 503, err
	}
	req.Header.Set("Authorization", "Bearer "+h.Token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Settings-Actor", c.GetString("quality_actor"))
	response, err := h.Client.Do(req)
	if err != nil {
		return nil, 503, err
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 8*1024*1024+1))
	if len(data) > 8*1024*1024 {
		return nil, 503, io.ErrShortBuffer
	}
	return data, response.StatusCode, err
}

func (h *DocumentDefaultsHandler) Handle(c *gin.Context) {
	if h.URL == "" || len(h.Token) < 32 {
		c.JSON(503, gin.H{"error": "Document template service is not configured"})
		return
	}
	action := c.Param("action")
	allowed := map[string]bool{"": true, "save": true, "publish": true, "check": true, "render": true, "preview": true, "bind": true, "project": true}
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
	var bindingRequest struct {
		Project string `json:"project"`
	}
	if action == "/bind" && h.Store != nil {
		if err := json.Unmarshal(payload, &bindingRequest); err != nil {
			c.JSON(422, gin.H{"error": "Invalid project binding"})
			return
		}
		if _, err := h.Store.GetProject(c.Request.Context(), bindingRequest.Project); err != nil {
			c.JSON(404, gin.H{"error": "Project not found"})
			return
		}
	}
	data, status, err := h.request(c, action, payload)
	if err != nil {
		c.JSON(503, gin.H{"error": "Document template service unavailable"})
		return
	}
	if status == 200 && action == "/bind" && h.Store != nil {
		var binding struct {
			Directories []map[string]string `json:"directories"`
		}
		if err := json.Unmarshal(data, &binding); err != nil {
			c.JSON(503, gin.H{"error": "Invalid template service response"})
			return
		}
		if err := h.Store.EnsureDocumentDirectories(c.Request.Context(), bindingRequest.Project, binding.Directories); err != nil {
			c.JSON(503, gin.H{"error": "Project directories could not be synchronized; retry the binding"})
			return
		}
	}
	c.Data(status, "application/json", data)
}

// InitializeProject binds new projects to the published system contract.
func (h *DocumentDefaultsHandler) InitializeProject(c *gin.Context, projectID, name, version string, modules []string) ([]map[string]string, error) {
	if h.URL == "" || len(h.Token) < 32 {
		return nil, templateError("Document template service is not configured")
	}
	payload, _ := json.Marshal(gin.H{"project": projectID, "name": name, "product_version": version, "modules": modules})
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
	var binding struct {
		Directories []map[string]string `json:"directories"`
	}
	if err := json.Unmarshal(data, &binding); err != nil {
		return nil, err
	}
	return binding.Directories, nil
}

type templateError string

func (e templateError) Error() string { return string(e) }
