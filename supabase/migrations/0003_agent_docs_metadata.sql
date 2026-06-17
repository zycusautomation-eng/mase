-- 0003_agent_docs_metadata.sql
-- Knowledge-base metadata for the task-completion agent (Admin → Agent Control).
--
-- The agent's document store (public.documents + public.document_chunks) currently
-- carries only {id, name, file_path, content, embedding, project_id}, so retrieval
-- can filter only by project/chat/name. This migration adds the metadata the
-- retrieval layer needs to route by document TYPE and rank by recency, plus a
-- keyword (FTS) column to enable hybrid search alongside the pgvector embedding.
--
-- SAFE + IDEMPOTENT: all additive (ADD COLUMN IF NOT EXISTS). No data is moved or
-- dropped. The backend already handles the pre-migration state gracefully (it
-- probes for doc_type and falls back to encoding the type in the document name),
-- so applying this is non-breaking and can happen any time.
--
-- After this lands, the backend (upload_document) will store doc_type natively and
-- a follow-up enables doc-type/recency-filtered hybrid retrieval (see
-- docs/agent-architecture.md §1).

-- ── documents ───────────────────────────────────────────────────────────────
alter table public.documents
  add column if not exists doc_type     text,        -- 'playbook'|'guide'|'email_template'|'transcript'|'showpad_asset'|'other'
  add column if not exists source       text,        -- 'manual_upload'|'showpad'|'avoma'|'salesforce'|...
  add column if not exists title        text,
  add column if not exists recency_at   timestamptz,
  add column if not exists metadata     jsonb default '{}'::jsonb;

-- ── document_chunks ─────────────────────────────────────────────────────────
-- Denormalize doc_type/recency onto chunks so the ANN/keyword query can pre-filter
-- in SQL (WHERE doc_type = ANY(...)) before ranking, instead of fetching all chunks
-- and filtering in Python.
alter table public.document_chunks
  add column if not exists doc_type    text,
  add column if not exists section     text,
  add column if not exists recency_at  timestamptz,
  add column if not exists token_count int,
  add column if not exists metadata    jsonb default '{}'::jsonb;

-- Keyword (full-text) column for hybrid retrieval. Generated + indexed.
alter table public.document_chunks
  add column if not exists content_fts tsvector
    generated always as (to_tsvector('english', coalesce(content, ''))) stored;

create index if not exists document_chunks_content_fts_idx
  on public.document_chunks using gin (content_fts);
create index if not exists document_chunks_doctype_project_idx
  on public.document_chunks (doc_type, project_id);
create index if not exists document_chunks_recency_idx
  on public.document_chunks (recency_at);
create index if not exists documents_doc_type_idx
  on public.documents (doc_type);
