-- Directory defaults are now resolved from the published document template
-- definition by the application. Do not keep a second hard-coded initializer.
DROP TRIGGER IF EXISTS project_default_document_directories ON projects;
DROP FUNCTION IF EXISTS initialize_new_project_directories();
DROP FUNCTION IF EXISTS initialize_document_directories(TEXT);
