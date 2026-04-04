create table if not exists apps (
  app_id text primary key,
  review_state text not null check (review_state in ('pending', 'approved', 'rejected', 'suspended')),
  registered_at bigint not null,
  reviewed_at bigint,
  review_notes text,
  manifest jsonb not null
);

create table if not exists review_actions (
  id text primary key,
  app_id text not null references apps(app_id) on delete cascade,
  version text not null,
  action text not null check (action in ('approve', 'reject', 'suspend', 'reinstate', 'request_changes')),
  reviewer_id text not null,
  notes text,
  timestamp bigint not null
);

create table if not exists class_allowlists (
  id text primary key,
  class_id text not null,
  app_id text not null references apps(app_id) on delete cascade,
  enabled_by text not null,
  enabled_at bigint not null,
  disabled_at bigint
);

create index if not exists class_allowlists_class_id_idx on class_allowlists(class_id);
create index if not exists class_allowlists_app_id_idx on class_allowlists(app_id);

create table if not exists audit_events (
  id text primary key,
  timestamp bigint not null,
  trace_id text not null,
  event_type text not null,
  source text not null check (source in ('frontend', 'bridge-backend', 'app')),
  session_id text,
  class_id text,
  student_id text,
  app_id text,
  app_version text,
  summary text,
  metadata jsonb
);

create index if not exists audit_events_timestamp_idx on audit_events(timestamp);
create index if not exists audit_events_trace_id_idx on audit_events(trace_id);
create index if not exists audit_events_app_id_idx on audit_events(app_id);

create table if not exists bridge_sessions (
  id text primary key,
  session_id text not null,
  user_id text not null,
  bridge_state jsonb not null,
  updated_at bigint not null
);

create index if not exists bridge_sessions_session_id_idx on bridge_sessions(session_id);
create index if not exists bridge_sessions_user_id_idx on bridge_sessions(user_id);

create table if not exists app_context_snapshots (
  id text primary key,
  session_id text not null,
  user_id text not null,
  app_id text not null references apps(app_id) on delete cascade,
  status text not null check (status in ('idle', 'ready', 'active', 'error', 'complete')),
  summary text,
  last_state jsonb,
  last_error text,
  captured_at bigint not null
);

create index if not exists app_context_snapshots_session_id_idx on app_context_snapshots(session_id);
create index if not exists app_context_snapshots_user_id_idx on app_context_snapshots(user_id);
create index if not exists app_context_snapshots_app_id_idx on app_context_snapshots(app_id);
create index if not exists app_context_snapshots_captured_at_idx on app_context_snapshots(captured_at);
