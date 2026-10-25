// Central public base URL for the backend.
// - Render: RENDER_EXTERNAL_URL is auto-injected (https://<service>.onrender.com)
// - Local dev: falls back to http://localhost:5000
// - Custom domains: override with PUBLIC_BASE_URL
module.exports = function getPublicBaseUrl() {
  return (
    process.env.PUBLIC_BASE_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    'http://localhost:5000'
  );
};
