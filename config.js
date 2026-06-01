// TramsTec — runtime config injected before script.js.
//
// WAITLIST_MODE: true while the backend API isn't live in production.
//   - skips the /public/plans fetch (uses baked-in fallback pricing)
//   - the checkout form posts to /api/waitlist (a Vercel serverless function
//     in this same project) and shows a "gracias, te avisaremos" inline
//   - flip to false the moment api.tramstec.com is deployed and Stripe is live
//
// WCM_API_BASE: used only when WAITLIST_MODE is false.
window.WCM_WAITLIST_MODE = true;
window.WCM_API_BASE = "https://api.tramstec.com";
