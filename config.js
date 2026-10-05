// IAF client configuration. These two values are PUBLIC by design (they ship to
// every browser). Row Level Security in the database is what protects the data.
// NEVER put the service_role / secret key here.
window.IAF_CONFIG = {
  SUPABASE_URL: "https://vevgyuhybmlobnhtsgrk.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZldmd5dWh5Ym1sb2JuaHRzZ3JrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5MzE0ODcsImV4cCI6MjEwNDUwNzQ4N30.vzD7D0dThbvJeOHseN5cM4WqEJGog-IVW3EQkWb2LUI"
};
