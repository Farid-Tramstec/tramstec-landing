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
      currency: "MXN",
      addedToCart: (label) => `Plan ${label} seleccionado.`,
      enterpriseSalesLed: "Enterprise se cotiza con ventas. Escríbenos a ventas@tramstec.com.",
      acceptTerms: "Debes aceptar los términos para continuar.",
      preparingPayment: "Generando sesión de pago segura…",
      preparingButton: "Preparando pago…",
      payButton: "Pagar",
      paymentError: (msg) => `No pudimos iniciar el pago: ${msg}`,
      backendInvalid: "Respuesta inválida del servidor.",
      monthlyLine: (label, amount) => `<div class="cart-line"><span>Plan ${label}</span><strong>${amount}/mes</strong></div>`,
      toolCallsLine: (n) => `<div class="cart-line"><span>${n} tool calls/mes</span><strong>Incluido</strong></div>`,
      memoryOpsLine: (n) => `<div class="cart-line"><span>${n} memory ops/mes</span><strong>Incluido</strong></div>`,
      conversationsLine: (n) => `<div class="cart-line"><span>${n} conversaciones/mes</span><strong>Incluido</strong></div>`,
      freeForever: "Gratis · siempre",
      customPricing: "A la medida",
      // Waitlist mode (backend API aún no en vivo)
      waitlistButton: "Apartar mi lugar",
      waitlistSubmitting: "Registrando…",
      waitlistSuccess: "¡Listo! Te avisaremos por correo cuando abramos plazas. Gracias por confiar en TramsTec.",
      waitlistError: (msg) => `No pudimos registrarte: ${msg}. Escríbenos a hola@tramstec.com.`,
    },
    en: {
      locale: "en-US",
      currency: "USD",
      addedToCart: (label) => `${label} plan selected.`,
      enterpriseSalesLed: "Enterprise is sales-led. Email us at sales@tramstec.com.",
      acceptTerms: "You must accept the terms to continue.",
      preparingPayment: "Creating a secure payment session…",
      preparingButton: "Preparing payment…",
      payButton: "Pay",
      paymentError: (msg) => `Couldn't start the payment: ${msg}`,
      backendInvalid: "Invalid response from the server.",
      monthlyLine: (label, amount) => `<div class="cart-line"><span>${label} plan</span><strong>${amount}/mo</strong></div>`,
      toolCallsLine: (n) => `<div class="cart-line"><span>${n} tool calls/mo</span><strong>Included</strong></div>`,
      memoryOpsLine: (n) => `<div class="cart-line"><span>${n} memory ops/mo</span><strong>Included</strong></div>`,
      conversationsLine: (n) => `<div class="cart-line"><span>${n} conversations/mo</span><strong>Included</strong></div>`,
      freeForever: "Free · forever",
      customPricing: "Custom",
      // Waitlist mode (backend not live yet)
      waitlistButton: "Reserve my spot",
      waitlistSubmitting: "Saving…",
      waitlistSuccess: "You're in! We'll email you when seats open up. Thanks for trusting TramsTec.",
      waitlistError: (msg) => `Couldn't add you to the list: ${msg}. Write us at hello@tramstec.com.`,
    },
  };
  const T = I18N[LANG];

  // -----------------------------------------------------------------
  // Analytics — Plausible event helper. Defensive: silent no-op if
  // Plausible script hasn't loaded (adblock, offline, etc.). Never throws.
  // -----------------------------------------------------------------
  function track(event, props) {
    try {
      if (typeof window.plausible === "function") {
        window.plausible(event, props ? { props } : undefined);
      }
    } catch (_) { /* never break the page on analytics failure */ }
  }

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
  // Pricing — operational infrastructure for AI agents on WhatsApp.
  // Four plans: Developer (free) / Production / Platform / Enterprise.
  // Prices in MINOR units (cents). USD across locales — pricing wording is English.
  // -----------------------------------------------------------------
  const PRICING = {
    es: {
      currency: "USD",
      plans: {
        developer:  { label: "Developer",  monthly_cents:      0, customLabel: "Free" },
        production: { label: "Production", monthly_cents:   9900 },
        platform:   { label: "Platform",   monthly_cents:  99900 },
        enterprise: { label: "Enterprise", monthly_cents:      0, customLabel: "Custom" },
      },
      addons: {
        payments: { label: "Pagos LATAM extendidos", monthly_cents: 30000 },
        erp:      { label: "Conectores de negocio",  monthly_cents: 50000 },
        priority: { label: "AI Ops prioritario",     monthly_cents: 40000 },
      },
    },
    en: {
      currency: "USD",
      plans: {
        developer:  { label: "Developer",  monthly_cents:      0, customLabel: "Free" },
        production: { label: "Production", monthly_cents:   9900 },
        platform:   { label: "Platform",   monthly_cents:  99900 },
        enterprise: { label: "Enterprise", monthly_cents:      0, customLabel: "Custom" },
      },
      addons: {
        payments: { label: "Extended LATAM payments", monthly_cents: 30000 },
        erp:      { label: "Business connectors",     monthly_cents: 50000 },
        priority: { label: "Priority AI Ops",         monthly_cents: 40000 },
      },
    },
  };

  const fallback = PRICING[LANG] || PRICING.es;
  let plans = fallback.plans;
  let addons = fallback.addons;

  const API_BASE = window.WCM_API_BASE || "http://localhost:3001";
  const WAITLIST_MODE = !!window.WCM_WAITLIST_MODE;

  // Relabel the submit button in waitlist mode.
  if (WAITLIST_MODE) {
    const submitEarly = document.querySelector("[data-checkout-submit]");
    if (submitEarly) submitEarly.textContent = T.waitlistButton;
  }

  // Hydrate from backend if available. In waitlist mode the backend
  // isn't live — skip the fetch entirely and use the baked-in tiers.
  if (!WAITLIST_MODE) fetch(`${API_BASE}/public/plans`, { credentials: "omit" })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (!data) return;
      // Backend response shape: { plans: [{slug, label, monthly_cents, ...}], addons: [...] }
      const byPlan = Object.fromEntries((data.plans || []).map((p) => [p.slug, p]));
      const byAddon = Object.fromEntries((data.addons || []).map((a) => [a.slug, a]));
      if (Object.keys(byPlan).length) plans = byPlan;
      if (Object.keys(byAddon).length) addons = byAddon;
      renderCart();
    })
    .catch(() => { /* fallback already rendered */ });

  // -----------------------------------------------------------------
  // Cart state + render
  // -----------------------------------------------------------------
  const money = new Intl.NumberFormat(T.locale, { style: "currency", currency: fallback.currency, maximumFractionDigits: 0 });
  const numFmt = new Intl.NumberFormat(T.locale);
  // Default selection is Agency (the "recommended" tier in the new pricing).
  const cart = { plan: "production", addons: new Set() };

  const planLabel = document.querySelector("[data-cart-plan]");
  const cartLines = document.querySelector("[data-cart-lines]");
  const cartTotal = document.querySelector("[data-cart-total]");
  const status = document.querySelector("[data-checkout-status]");

  function selectedPlan() {
    return plans[cart.plan] || plans.production || plans.developer;
  }

  function renderCart() {
    if (!cartLines || !cartTotal || !planLabel) return;
    const p = selectedPlan();
    const addonItems = Array.from(cart.addons).map((k) => addons[k]).filter(Boolean);
    const addonMonthly = addonItems.reduce((s, a) => s + (a.monthly_cents || 0), 0);
    const monthlyTotal = (p.monthly_cents || 0) + addonMonthly;
    const isEnterprise = cart.plan === "enterprise";
    const isFree = (p.monthly_cents || 0) === 0 && !isEnterprise;

    planLabel.textContent = p.label;
    cartLines.innerHTML = [
      T.monthlyLine(p.label, isEnterprise ? T.customPricing : (isFree ? T.freeForever : money.format((p.monthly_cents || 0) / 100))),
      p.tool_calls ? T.toolCallsLine(numFmt.format(p.tool_calls)) : "",
      p.memory_ops ? T.memoryOpsLine(numFmt.format(p.memory_ops)) : "",
      p.conversations ? T.conversationsLine(numFmt.format(p.conversations)) : "",
      ...addonItems.map((a) => `<div class="cart-line"><span>${a.label}</span><strong>${money.format((a.monthly_cents || 0) / 100)}</strong></div>`),
    ].filter(Boolean).join("");
    cartTotal.textContent = isEnterprise ? T.customPricing : (monthlyTotal === 0 ? T.freeForever : money.format(monthlyTotal / 100));
  }

  document.querySelectorAll("[data-plan]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const slug = btn.getAttribute("data-plan");
      if (!slug || !plans[slug]) return;
      cart.plan = slug;
      renderCart();
      track("Plan Selected", { plan: slug, lang: LANG });
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
          track("Waitlist Submit", { result: "success", plan: payload.plan_slug || "unknown", lang: LANG });
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
          track("Waitlist Submit", { result: "error", plan: payload.plan_slug || "unknown", lang: LANG });
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
