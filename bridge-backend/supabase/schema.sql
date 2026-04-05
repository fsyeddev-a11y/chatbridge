create table if not exists apps (
  app_id text primary key,
  review_state text not null check (review_state in ('pending', 'approved', 'rejected', 'suspended')),
  registered_at bigint not null,
  reviewed_at bigint,
  review_notes text,
  active_version text,
  owner_user_id text,
  owner_email text,
  manifest jsonb not null
);

alter table apps add column if not exists active_version text;
alter table apps add column if not exists owner_user_id text;
alter table apps add column if not exists owner_email text;

create table if not exists app_versions (
  id text primary key,
  app_id text not null references apps(app_id) on delete cascade,
  version text not null,
  review_state text not null check (review_state in ('pending', 'approved', 'rejected', 'suspended')),
  submitted_at bigint not null,
  reviewed_at bigint,
  review_notes text,
  owner_user_id text,
  owner_email text,
  manifest jsonb not null
);

create unique index if not exists app_versions_app_id_version_idx on app_versions(app_id, version);
create index if not exists app_versions_app_id_idx on app_versions(app_id);

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

create table if not exists oauth_tokens (
  id text primary key,
  user_id text not null,
  app_id text not null references apps(app_id) on delete cascade,
  provider text not null,
  access_token text not null,
  refresh_token text,
  expires_at bigint,
  scopes jsonb not null default '[]'::jsonb,
  created_at bigint not null,
  last_refreshed_at bigint
);

create unique index if not exists oauth_tokens_user_app_provider_idx on oauth_tokens(user_id, app_id, provider);

create table if not exists user_profiles (
  user_id text primary key,
  email text,
  role text not null check (role in ('admin', 'teacher', 'student', 'developer')),
  created_at bigint not null,
  updated_at bigint not null
);

create index if not exists user_profiles_role_idx on user_profiles(role);
create index if not exists user_profiles_email_idx on user_profiles(email);

create table if not exists chat_sessions (
  id text primary key,
  user_id text not null references user_profiles(user_id) on delete cascade,
  name text not null,
  type text check (type in ('chat', 'picture')),
  starred boolean,
  hidden boolean,
  assistant_avatar_key text,
  pic_url text,
  order_index bigint not null,
  payload jsonb not null,
  created_at bigint not null,
  updated_at bigint not null
);

create index if not exists chat_sessions_user_id_idx on chat_sessions(user_id);
create index if not exists chat_sessions_user_id_order_index_idx on chat_sessions(user_id, order_index);
