BEGIN;
CREATE TABLE sources (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
 homepage text NOT NULL CHECK (homepage LIKE 'https://%'),
 usage_status text NOT NULL DEFAULT 'pending' CHECK (usage_status IN ('pending','allowed','blocked')),
 rights_reference text,
 CHECK (usage_status <> 'allowed' OR nullif(trim(rights_reference),'') IS NOT NULL)
);
CREATE TABLE stories (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE story_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), story_id uuid NOT NULL REFERENCES stories(id),
 revision integer NOT NULL CHECK (revision > 0), title text NOT NULL, summary text NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','approved','published','withdrawn')),
 reviewed_by text, reviewed_at timestamptz, published_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(story_id,revision),
 CHECK (status NOT IN ('approved','published') OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
 CHECK (status <> 'published' OR published_at IS NOT NULL)
);
CREATE TABLE evidence (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id uuid NOT NULL REFERENCES sources(id),
 origin_key text NOT NULL, url text NOT NULL CHECK (url LIKE 'https://%'), excerpt text NOT NULL,
 published_at timestamptz NOT NULL, fetched_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE claims (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), version_id uuid NOT NULL REFERENCES story_versions(id),
 content text NOT NULL, kind text NOT NULL CHECK (kind IN ('confirmed','uncertain','opinion','interpretation'))
);
CREATE TABLE claim_evidence (
 claim_id uuid NOT NULL REFERENCES claims(id), evidence_id uuid NOT NULL REFERENCES evidence(id),
 support text NOT NULL CHECK (support IN ('supports','contradicts','context')),
 PRIMARY KEY(claim_id,evidence_id)
);
CREATE TABLE corrections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), old_version_id uuid NOT NULL REFERENCES story_versions(id),
 new_version_id uuid NOT NULL REFERENCES story_versions(id), reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), CHECK (old_version_id <> new_version_id)
);
CREATE TABLE audio_assets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), version_id uuid NOT NULL REFERENCES story_versions(id),
 provider text NOT NULL, voice_key text NOT NULL, text_hash text NOT NULL, object_key text NOT NULL,
 duration_ms integer NOT NULL CHECK (duration_ms > 0), UNIQUE(version_id,provider,voice_key,text_hash)
);
CREATE TABLE jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL, idempotency_key text NOT NULL UNIQUE,
 payload jsonb NOT NULL DEFAULT '{}', state text NOT NULL DEFAULT 'queued'
 CHECK (state IN ('queued','running','done','failed')), attempts integer NOT NULL DEFAULT 0,
 available_at timestamptz NOT NULL DEFAULT now(), locked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_due ON jobs(available_at) WHERE state='queued';
CREATE INDEX claims_version ON claims(version_id);
-- No user data until identity, authorization and retention decisions are approved.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
COMMIT;
