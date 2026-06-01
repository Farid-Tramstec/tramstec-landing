// TramsTec landing — theme toggle, cart, Stripe Checkout submit, i18n.
//
// i18n: reads window.WCM_LANG ("es" | "en"). The HTML files of each locale
// set this before script.js loads. Default is "es". Only dynamic strings
// (status messages, cart line labels, plan-added toasts) live in the dict
// below — all static copy is per-HTML-file.
//
// Reads plan + addon pricing live from the backend (/public/plans). Falls
// back to a baked-in copy so the page still renders if the API is down.
//
// On submit, posts to /public/checkout/start and redirects to Stripe.
// We NEVER call Stripe.js directly here — the backend creates the Checkout
// Session so secrets and price IDs stay server-side.
(function () {
  const LANG = (window.WCM_LANG === "en") ? "en" : "es";
  const I18N = {
    es: {
      locale: "es-MX",
      addedToCart: (label) => `${label} agregado al carrito.`,
      enterpriseSalesLed: "Enterprise se cotiza con ventas. Escríbenos a ventas@tramstec.com.",
      acceptTerms: "Debes aceptar los términos para continuar.",
      preparingPayment: "Generando sesión de pago segura…",
      preparingButton: "Preparando pago…",
      payButton: "Pagar",
      paymentError: (msg) => `No pudimos iniciar el pago: ${msg}`,
      backendInvalid: "Respuesta inválida del servidor.",
      setupLine: (label, amount) => `<div class="cart-line"><span>Setup ${label}</span><strong>${amount}</strong></div>`,
      monthlyLine: (label, amount) => `<div class="cart-line"><span>Primer mes ${label}</span><strong>${amount}</strong></div>`,
      includedLine: (n) => `<div class="cart-line"><span>${n} conversaciones IA</span><strong>Incluido</strong></div>`,
      // Waitlist mode (backend API aún no en vivo)
      waitlistButton: "Apartar mi lugar",
      waitlistSubmitting: "Registrando…",
      waitlistSuccess: "¡Listo! Te avisaremos por correo cuando abramos plazas. Gracias por confiar en TramsTec.",
      waitlistError: (msg) => `No pudimos registrarte: ${msg}. Escríbenos a hola@tramstec.com.`,
    },
    en: {
      locale: "en-US",
      addedToCart: (label) => `${label} added to cart.`,
      enterpriseSalesLed: "Enterprise is sales-led. Email us at sales@tramstec.com.",
      acceptTerms: "You must accept the terms to continue.",
      preparingPayment: "Creating a secure payment session…",
      preparingButton: "Preparing payment…",
      payButton: "Pay",
      paymentError: (msg) => `Couldn't start the payment: ${msg}`,
      backendInvalid: "Invalid response from the server.",
      setupLine: (label, amount) => `<div class="cart-line"><span>${label} setup</span><strong>${amount}</strong></div>`,
      monthlyLine: (label, amount) => `<div class="cart-line"><span>${label} first month</span><strong>${amount}</strong></div>`,
      includedLine: (n) => `<div class="cart-line"><span>${n} AI conversations</span><strong>Included</strong></div>`,
      // Waitlist mode (backend not live yet)
      waitlistButton: "Reserve my spot",
      waitlistSubmitting: "Saving…",
      waitlistSuccess: "You're in! We'll email you when seats open up. Thanks for trusting TramsTec.",
      waitlistError: (msg) => `Couldn't add you to the list: ${msg}. Write us at hello@tramstec.com.`,
    },
  };
  const T = I18N[LANG];
  // -----------------------------------------------------------------
  // Theme toggle + footer year (unchanged from the original landing).
  // -----------------------------------------------------------------
  const root = document.documentElement;
  const themeToggle = document.querySelector("[data-theme-toggle]");
  const SUN = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';
  const MOON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>';
  function applyTheme(mode) {
    root.setAttribute("data-theme", mode);
    if (themeToggle) {
      themeToggle.innerHTML = mode === "dark" ? SUN : MOON;
      themeToggle.setAttribute("aria-label", mode === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro");
    }
  }
  let mode = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  applyTheme(mode);
  if (themeToggle) themeToggle.addEventListener("click", () => { mode = mode === "dark" ? "light" : "dark"; applyTheme(mode); });
  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  // -----------------------------------------------------------------
  // Pricing data — fallback. Will be overwritten if /public/plans responds.
  // Cents (centavos). Keep in sync with packages/db/src/seed.ts.
  // -----------------------------------------------------------------
  const fallback = {
    plans: {
      starter:    { label: "Starter",    setup_cents:  800000, monthly_cents:  600000, included_conversations:   500 },
      growth:     { label: "Growth",     setup_cents: 2500000, monthly_cents: 1200000, included_conversations:  2000 },
      scale:      { label: "Scale",      setup_cents: 5000000, monthly_cents: 3500000, included_conversations: 10000 },
      enterprise: { label: "Enterprise", setup_cents:       0, monthly_cents:       0, included_conversations:  null  },
    },
    addons: {
      payments: { label: "Pagos LatAm",         monthly_cents: 500000 },
      erp:      { label: "ERP / CRM connector", monthly_cents: 800000 },
      priority: { label: "AI Ops prioritario",  monthly_cents: 600000 },
    },
  };

  let plans = fallback.plans;
  let addons = fallback.addons;

  const API_BASE = window.WCM_API_BASE || "http://localhost:3001";
  const WAITLIST_MODE = !!window.WCM_WAITLIST_MODE;

  // Relabel the submit button in waitlist mode.
  if (WAITLIST_MODE) {
    const submitEarly = document.querySelector("[data-checkout-submit]");
    if (submitEarly) submitEarly.textContent = T.waitlistButton;
  }

  // Hydrate from backend; ignore failure (fallback is fine).
  // In waitlist mode the backend isn't live — skip the fetch entirely.
  if (!WAITLIST_MODE) fetch(`${API_BASE}/public/plans`, { credentials: "omit" })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (!data) return;
      plans = Object.fromEntries((data.plans || []).map((p) => [p.slug, p]));
      addons = Object.fromEntries((data.addons || []).map((a) => [a.slug, a]));
      renderCart();
    })
    .catch(() => { /* fallback already rendered */ });

  // -----------------------------------------------------------------
  // Cart state + render
  // -----------------------------------------------------------------
  const money = new Intl.NumberFormat(T.locale, { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
  const cart = { plan: "growth", addons: new Set() };

  const planLabel = document.querySelector("[data-cart-plan]");
  const cartLines = document.querySelector("[data-cart-lines]");
  const cartTotal = document.querySelector("[data-cart-total]");
  const status = document.querySelector("[data-checkout-status]");

  function selectedPlan() {
    return plans[cart.plan] || plans.growth;
  }

  function renderCart() {
    if (!cartLines || !cartTotal || !planLabel) return;
    const p = selectedPlan();
    const addonItems = Array.from(cart.addons).map((k) => addons[k]).filter(Boolean);
    const addonMonthly = addonItems.reduce((s, a) => s + (a.monthly_cents || 0), 0);
    const first = (p.setup_cents || 0) + (p.monthly_cents || 0) + addonMonthly;

    planLabel.textContent = p.label;
    cartLines.innerHTML = [
      T.setupLine(p.label, money.format((p.setup_cents || 0) / 100)),
      T.monthlyLine(p.label, money.format((p.monthly_cents || 0) / 100)),
      p.included_conversations ? T.includedLine(p.included_conversations.toLocaleString(T.locale)) : "",
      ...addonItems.map((a) => `<div class="cart-line"><span>${a.label}</span><strong>${money.format((a.monthly_cents || 0) / 100)}</strong></div>`),
    ].filter(Boolean).join("");
    cartTotal.textContent = money.format(first / 100);
  }

  document.querySelectorAll("[data-plan]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const slug = btn.getAttribute("data-plan");
      if (!slug || !plans[slug]) return;
      cart.plan = slug;
      renderCart();
      document.getElementById("comprar")?.scrollIntoView({ behavior: "smooth" });
      if (status) status.textContent = T.addedToCart(plans[slug].label);
    });
  });

  document.querySelectorAll("[data-addon]").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.getAttribute("data-addon");
      if (!key) return;
      if (input.checked) cart.addons.add(key);
      else cart.addons.delete(key);
      renderCart();
    });
  });

  // -----------------------------------------------------------------
  // Checkout submit
  // -----------------------------------------------------------------
  const form = document.querySelector("[data-checkout-form]");
  const submitBtn = document.querySelector("[data-checkout-submit]");

  function setStatus(msg, kind) {
    if (!status) return;
    status.textContent = msg || "";
    status.dataset.kind = kind || "";
  }

  if (form) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(form);

      if (cart.plan === "enterprise") {
        setStatus(T.enterpriseSalesLed, "info");
        return;
      }

      const payload = {
        email: String(fd.get("email") || "").trim().toLowerCase(),
        workspace_name: String(fd.get("workspace") || "").trim(),
        framework: String(fd.get("framework") || ""),
        plan_slug: cart.plan,
        addon_slugs: Array.from(cart.addons),
        fiscal: cleanFiscal({
          rfc: String(fd.get("fiscal_rfc") || "").trim(),
          business_name: String(fd.get("fiscal_business_name") || "").trim(),
          postal_code: String(fd.get("fiscal_postal_code") || "").trim(),
        }),
        terms_accepted: !!fd.get("terms"),
      };

      if (!payload.terms_accepted) {
        setStatus(T.acceptTerms, "error");
        return;
      }

      submitBtn?.setAttribute("disabled", "true");
      const originalLabel = submitBtn?.textContent;
      if (submitBtn) submitBtn.textContent = WAITLIST_MODE ? T.waitlistSubmitting : T.preparingButton;
      setStatus(WAITLIST_MODE ? T.waitlistSubmitting : T.preparingPayment, "info");

      // ---------- Waitlist mode ----------
      // API backend isn't live yet — POST the lead to /api/waitlist
      // (Vercel serverless function in this same project) and show a
      // friendly inline confirmation instead of redirecting to Stripe.
      if (WAITLIST_MODE) {
        try {
          const res = await fetch("/api/waitlist", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: payload.email,
              workspace: payload.workspace_name,
              framework: payload.framework,
              plan: payload.plan_slug,
              addons: payload.addon_slugs,
              fiscal: payload.fiscal,
              lang: LANG,
            }),
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
          setStatus(T.waitlistSuccess, "success");
          form.reset();
          // Clear cart so the UI returns to a neutral state.
          cart.plan = null;
          cart.addons.clear();
          renderCart();
          if (submitBtn) {
            submitBtn.textContent = T.waitlistButton;
            // leave it disabled to discourage duplicate submits
          }
        } catch (err) {
          setStatus(T.waitlistError(err instanceof Error ? err.message : String(err)), "error");
          if (submitBtn) {
            submitBtn.removeAttribute("disabled");
            submitBtn.textContent = T.waitlistButton;
          }
        }
        return;
      }

      // ---------- Live checkout mode (Stripe) ----------
      try {
        const res = await fetch(`${API_BASE}/public/checkout/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "omit",
          body: JSON.stringify(payload),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          const msg = body?.error?.message || `Error ${res.status}`;
          throw new Error(msg);
        }
        if (!body.checkout_url) throw new Error(T.backendInvalid);
        // Redirect to Stripe Checkout. After payment, Stripe returns to
        // /success.html?signup=... which polls /public/checkout/status/:id.
        window.location.href = body.checkout_url;
      } catch (err) {
        setStatus(T.paymentError(err instanceof Error ? err.message : String(err)), "error");
        if (submitBtn) {
          submitBtn.removeAttribute("disabled");
          submitBtn.textContent = originalLabel || T.payButton;
        }
      }
    });
  }

  function cleanFiscal(f) {
    const out = {};
    if (f.rfc) out.rfc = f.rfc.toUpperCase();
    if (f.business_name) out.business_name = f.business_name;
    if (f.postal_code) out.postal_code = f.postal_code;
    return Object.keys(out).length > 0 ? out : undefined;
  }

  renderCart();
})();
