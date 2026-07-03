document.documentElement.classList.remove("no-js");

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const shopifyRoot = window.Shopify?.routes?.root || "/";
const collectionSearchState = new Map();
const predictiveSearchCache = new Map();
const PREDICTIVE_SEARCH_CACHE_LIMIT = 24;
const recentProductsStorageKey = "rp-recently-viewed-products";

let revealObserver;
let announcementRotationTimer;

const setHiddenState = (node, hidden) => {
  if (!node) return;

  node.hidden = hidden;
  node.setAttribute("aria-hidden", hidden ? "true" : "false");
};

const cachePredictiveSearch = (query, products) => {
  if (predictiveSearchCache.size >= PREDICTIVE_SEARCH_CACHE_LIMIT) {
    const oldestQuery = predictiveSearchCache.keys().next().value;
    predictiveSearchCache.delete(oldestQuery);
  }

  predictiveSearchCache.set(query, products);
};

const closeTopOverlay = () => {
  const lightbox = document.querySelector("[data-rp-lightbox]");

  if (lightbox && !lightbox.hidden) {
    lightbox.querySelector("[data-rp-lightbox-close]")?.click();
    return;
  }

  const cartDrawer = document.querySelector("[data-rp-cart-drawer]");

  if (cartDrawer && !cartDrawer.hidden) {
    cartDrawer.querySelector("[data-rp-cart-close]")?.click();
    return;
  }

  const searchPanel = document.querySelector("[data-rp-search-panel]");

  if (searchPanel && !searchPanel.hidden) {
    searchPanel.querySelector("[data-rp-search-close]")?.click();
    return;
  }

  if (document.body.classList.contains("rp-filters-open")) {
    document.body.classList.remove("rp-filters-open");
    return;
  }

  const mobileMenu = document.querySelector("[data-rp-mobile-menu]");

  if (mobileMenu?.open) {
    mobileMenu.open = false;
  }
};

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let activeTrapCleanup = null;

const trapFocus = (container) => {
  if (activeTrapCleanup) activeTrapCleanup();

  const handleKeydown = (event) => {
    if (event.key !== "Tab") return;
    const focusables = Array.from(container.querySelectorAll(FOCUSABLE)).filter((el) => !el.closest("[hidden]"));
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey) {
      if (document.activeElement === first) { event.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  };

  container.addEventListener("keydown", handleKeydown);
  activeTrapCleanup = () => container.removeEventListener("keydown", handleKeydown);
};

const releaseFocus = (returnTarget) => {
  if (activeTrapCleanup) { activeTrapCleanup(); activeTrapCleanup = null; }
  returnTarget?.focus();
};

const debounce = (callback, wait = 180) => {
  let timeoutId;

  return (...args) => {
    window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => callback(...args), wait);
  };
};

const parseHtml = (html) => new DOMParser().parseFromString(html, "text/html");

const escapeHtml = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const formatMoney = (amount, currency = "GBP") => {
  try {
    return new Intl.NumberFormat(document.documentElement.lang || undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format((Number(amount) || 0) / 100);
  } catch (error) {
    return `£${((Number(amount) || 0) / 100).toFixed(2)}`;
  }
};

const setHeaderOffset = () => {
  const header = document.querySelector("[data-rp-header]");

  if (!header) return;

  document.documentElement.style.setProperty("--rp-header-height", `${header.offsetHeight}px`);
};

const initHeader = () => {
  const header = document.querySelector("[data-rp-header]");

  if (!header) return;

  const updateHeader = () => {
    header.classList.toggle("is-scrolled", window.scrollY > 12);
  };

  setHeaderOffset();
  updateHeader();

  let scrollFramePending = false;

  window.addEventListener(
    "scroll",
    () => {
      if (scrollFramePending) return;

      scrollFramePending = true;
      window.requestAnimationFrame(() => {
        updateHeader();
        scrollFramePending = false;
      });
    },
    { passive: true }
  );
  window.addEventListener("resize", setHeaderOffset, { passive: true });
};

const initAnnouncementRotation = () => {
  const announcement = document.querySelector("[data-rp-announcement]");

  if (!announcement || prefersReducedMotion) return;

  const items = Array.from(announcement.querySelectorAll(".rp-announcement-bar__item"));

  if (items.length < 2) return;

  const rotationSpeed = Number(announcement.dataset.rotationSpeed) || 5000;
  let activeIndex = 0;

  const rotate = () => {
    items[activeIndex].classList.remove("is-active");
    activeIndex = (activeIndex + 1) % items.length;
    items[activeIndex].classList.add("is-active");
  };

  const startRotation = () => {
    if (announcementRotationTimer) return;

    announcementRotationTimer = window.setInterval(rotate, rotationSpeed);
  };

  const stopRotation = () => {
    if (!announcementRotationTimer) return;

    window.clearInterval(announcementRotationTimer);
    announcementRotationTimer = undefined;
  };

  startRotation();

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopRotation();
      return;
    }

    startRotation();
  });
};

const initDecorativeVideos = () => {
  const videos = Array.from(document.querySelectorAll("[data-rp-decorative-video]"));

  if (videos.length === 0) return;

  videos.forEach((video) => {
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;

    // Decorative autoplay videos should fall back to their poster for reduced-motion visitors.
    if (prefersReducedMotion) {
      video.removeAttribute("autoplay");
      video.pause();
      return;
    }

    const playPromise = video.play();

    if (playPromise?.catch) {
      playPromise.catch(() => {});
    }
  });
};

const initReveal = (scope = document) => {
  const revealNodes = Array.from(scope.querySelectorAll("[data-rp-reveal]")).filter(
    (node) => !node.classList.contains("is-visible")
  );

  if (revealNodes.length === 0) return;

  if (prefersReducedMotion || !("IntersectionObserver" in window)) {
    revealNodes.forEach((node) => node.classList.add("is-visible"));
    return;
  }

  if (!revealObserver) {
    revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            revealObserver.unobserve(entry.target);
          }
        });
      },
      {
        rootMargin: "0px 0px -10% 0px",
        threshold: 0.12,
      }
    );
  }

  revealNodes.forEach((node) => revealObserver.observe(node));
};

const initAccordions = () => {
  document.querySelectorAll("[data-rp-accordion]").forEach((accordion) => {
    const summary = accordion.querySelector("summary");

    if (!summary) return;

    summary.setAttribute("aria-expanded", accordion.open ? "true" : "false");
    accordion.addEventListener("toggle", () => {
      summary.setAttribute("aria-expanded", accordion.open ? "true" : "false");
    });
  });
};

const initFilters = () => {
  const toggle = document.querySelector("[data-rp-filter-toggle]");
  const panel = document.querySelector("[data-rp-filter-panel]");
  const closeButtons = document.querySelectorAll("[data-rp-filter-close]");

  if (!toggle || !panel) return;

  const closePanel = () => {
    document.body.classList.remove("rp-filters-open");
  };

  toggle.addEventListener("click", () => {
    document.body.classList.add("rp-filters-open");
    window.requestAnimationFrame(() => {
      const firstFocusable = panel.querySelector("button, input, select, summary");
      firstFocusable?.focus();
    });
  });

  closeButtons.forEach((button) => {
    button.addEventListener("click", closePanel);
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 989) {
      closePanel();
    }
  });
};

const initMobileMenu = () => {
  const menu = document.querySelector("[data-rp-mobile-menu]");

  if (!menu) return;

  const closeMenu = () => {
    menu.open = false;
  };

  document.addEventListener("click", (event) => {
    if (menu.open && !menu.contains(event.target)) {
      closeMenu();
    }
  });

  menu.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", closeMenu);
  });
};

const initCarousels = () => {
  document.querySelectorAll("[data-rp-carousel]").forEach((carousel) => {
    if (carousel.dataset.rpCarouselInit === "true") return;

    carousel.dataset.rpCarouselInit = "true";

    const track = carousel.querySelector("[data-rp-carousel-track]") || carousel;
    const slides = Array.from(track.querySelectorAll("[data-rp-carousel-slide]"));
    const container = carousel.closest(".rp-editorial-cards");

    if (!track || !container || slides.length === 0) return;

    const previousButton = container.querySelector("[data-rp-carousel-prev]");
    const nextButton = container.querySelector("[data-rp-carousel-next]");
    const currentCounter = container.querySelector("[data-rp-carousel-current]");
    const totalCounter = container.querySelector("[data-rp-carousel-total]");
    let activeIndex = 0;

    const formatIndex = (index) => String(index + 1).padStart(2, "0");

    const getClosestIndex = () =>
      slides.reduce(
        (closest, slide, index) => {
          const distance = Math.abs(slide.offsetLeft - carousel.scrollLeft);
          return distance < closest.distance ? { index, distance } : closest;
        },
        { index: 0, distance: Number.POSITIVE_INFINITY }
      ).index;

    const updateState = (index = getClosestIndex()) => {
      activeIndex = index;

      slides.forEach((slide, slideIndex) => {
        slide.classList.toggle("is-active", slideIndex === activeIndex);
      });

      if (currentCounter) {
        currentCounter.textContent = formatIndex(activeIndex);
      }

      if (previousButton) {
        previousButton.disabled = activeIndex === 0;
      }

      if (nextButton) {
        nextButton.disabled = activeIndex === slides.length - 1;
      }
    };

    const scrollToIndex = (index) => {
      const boundedIndex = Math.max(0, Math.min(index, slides.length - 1));
      activeIndex = boundedIndex;

      carousel.scrollTo({
        left: slides[boundedIndex].offsetLeft,
        behavior: prefersReducedMotion ? "auto" : "smooth",
      });

      updateState(boundedIndex);
    };

    previousButton?.addEventListener("click", () => {
      scrollToIndex(activeIndex - 1);
    });

    nextButton?.addEventListener("click", () => {
      scrollToIndex(activeIndex + 1);
    });

    carousel.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        scrollToIndex(activeIndex - 1);
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        scrollToIndex(activeIndex + 1);
      }
    });

    carousel.addEventListener("scroll", () => updateState(), { passive: true });
    window.addEventListener("resize", () => updateState());

    if (totalCounter) {
      totalCounter.textContent = String(slides.length).padStart(2, "0");
    }

    if (slides.length < 2) {
      container.classList.add("is-static");
    }

    updateState();
  });
};

const initCollectionSection = (root) => {
  if (!root || root.dataset.rpCollectionInit === "true") return;

  root.dataset.rpCollectionInit = "true";

  const collectionKey = root.dataset.rpCollectionKey || window.location.pathname;
  const collectionUrl = root.dataset.rpCollectionUrl || window.location.pathname;
  const searchInput = root.querySelector("[data-rp-collection-search]");
  const status = root.querySelector("[data-rp-collection-status]");
  const grid = root.querySelector("[data-rp-collection-grid]");
  const searchEmpty = root.querySelector("[data-rp-search-empty]");
  const clearSearchButton = root.querySelector("[data-rp-clear-search]");
  const filtersForm = root.querySelector("[data-rp-collection-filters-form]");
  const sortForm = root.querySelector("[data-rp-collection-sort-form]");
  let pagination = root.querySelector("[data-rp-collection-pagination]");
  let isLoading = false;
  let paginationObserver;

  const availableOnlyBtn = root.querySelector("[data-rp-available-only]");
  const getCards = () => Array.from(root.querySelectorAll("[data-rp-product-card]"));
  const isAvailableOnly = () => availableOnlyBtn?.getAttribute("aria-pressed") === "true";

  const applyClientSearch = () => {
    const searchTerm = (collectionSearchState.get(collectionKey) || "").toLowerCase();
    const availableOnly = isAvailableOnly();
    const cards = getCards();
    let visibleCount = 0;

    cards.forEach((card) => {
      const haystack = card.dataset.productSearch || "";
      const matchesSearch = searchTerm === "" || haystack.includes(searchTerm);
      const matchesAvailable = !availableOnly || card.dataset.productAvailable === "true";
      const matches = matchesSearch && matchesAvailable;

      card.hidden = !matches;
      card.classList.toggle("is-hidden-by-search", !matches);

      if (matches) {
        visibleCount += 1;
      }
    });

    if (status) {
      if (searchTerm || availableOnly) {
        const label = visibleCount === 1 ? "dress" : "dresses";
        const note = availableOnly ? " (available only)" : "";
        status.textContent = searchTerm
          ? `${visibleCount} ${label} match "${searchInput?.value.trim() || searchTerm}"${note}`
          : `${visibleCount} ${label} available`;
      } else {
        status.textContent = status.dataset.defaultStatus || status.textContent;
      }
    }

    if (searchEmpty) {
      searchEmpty.hidden = !((searchTerm || availableOnly) && visibleCount === 0 && cards.length > 0);
    }
  };

  if (availableOnlyBtn) {
    availableOnlyBtn.addEventListener("click", () => {
      const nowActive = availableOnlyBtn.getAttribute("aria-pressed") !== "true";
      availableOnlyBtn.setAttribute("aria-pressed", String(nowActive));
      availableOnlyBtn.classList.toggle("is-active", nowActive);
      applyClientSearch();
    });
  }

  root.addEventListener("click", (event) => {
    const removeLink = event.target.closest("[data-rp-filter-remove]");
    if (!removeLink) return;
    event.preventDefault();
    fetchCollectionMarkup(removeLink.href);
  });

  const serializeCollectionForms = () => {
    const params = new URLSearchParams();

    if (filtersForm) {
      new FormData(filtersForm).forEach((value, key) => {
        if (value !== "") {
          params.append(key, value);
        }
      });
    }

    if (sortForm) {
      const sortValue = new FormData(sortForm).get("sort_by");

      if (sortValue) {
        params.set("sort_by", sortValue);
      }
    }

    return params;
  };

  const setLoading = (loading) => {
    isLoading = loading;
    root.classList.toggle("is-loading", loading);
  };

  const fetchCollectionMarkup = async (url, { append = false } = {}) => {
    if (isLoading) return;

    setLoading(true);

    try {
      const response = await fetch(url, {
        headers: {
          "X-Requested-With": "XMLHttpRequest",
        },
      });

      if (!response.ok) {
        throw new Error(`Collection request failed with ${response.status}`);
      }

      const html = await response.text();
      const documentFragment = parseHtml(html);
      const incomingRoot = documentFragment.querySelector("[data-rp-collection-root]");

      if (!incomingRoot) {
        throw new Error("Updated collection markup was not found.");
      }

      collectionSearchState.set(collectionKey, searchInput?.value.trim() || "");

      if (append) {
        const incomingGrid = incomingRoot.querySelector("[data-rp-collection-grid]");
        const incomingPagination = incomingRoot.querySelector("[data-rp-collection-pagination]");
        const incomingStatus = incomingRoot.querySelector("[data-rp-collection-status]");

        if (grid && incomingGrid) {
          incomingGrid.querySelectorAll("[data-rp-product-card]").forEach((card) => {
            grid.append(card);
          });
        }

        if (pagination) {
          pagination.replaceWith(incomingPagination || document.createElement("div"));
        }

        pagination = root.querySelector("[data-rp-collection-pagination]");

        if (status && incomingStatus) {
          status.dataset.defaultStatus = incomingStatus.dataset.defaultStatus || incomingStatus.textContent.trim();

          if (!(collectionSearchState.get(collectionKey) || "")) {
            status.textContent = status.dataset.defaultStatus;
          }
        }

        initReveal(root);
        applyClientSearch();
        initInfiniteScroll();
        return;
      }

      root.replaceWith(incomingRoot);
      initReveal(incomingRoot);
      initCollectionSection(incomingRoot);
      window.history.replaceState({}, "", url);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const refreshCollection = debounce(() => {
    const url = new URL(collectionUrl, window.location.origin);
    url.search = serializeCollectionForms().toString();
    fetchCollectionMarkup(url.toString());
  }, 220);

  const initInfiniteScroll = () => {
    if (paginationObserver) {
      paginationObserver.disconnect();
    }

    if (!pagination || prefersReducedMotion || !("IntersectionObserver" in window)) return;

    const nextLink = pagination.querySelector("[data-rp-pagination-next]");

    if (!nextLink) return;

    paginationObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && nextLink.href) {
            paginationObserver.disconnect();
            fetchCollectionMarkup(nextLink.href, { append: true });
          }
        });
      },
      {
        rootMargin: "260px 0px",
        threshold: 0.2,
      }
    );

    paginationObserver.observe(pagination);
  };

  if (searchInput) {
    const existingSearch = collectionSearchState.get(collectionKey) || "";
    searchInput.value = existingSearch;

    searchInput.addEventListener(
      "input",
      debounce(() => {
        collectionSearchState.set(collectionKey, searchInput.value.trim());
        applyClientSearch();
      }, 180)
    );
  }

  if (clearSearchButton && searchInput) {
    clearSearchButton.addEventListener("click", () => {
      searchInput.value = "";
      collectionSearchState.set(collectionKey, "");
      applyClientSearch();
      searchInput.focus();
    });
  }

  filtersForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    refreshCollection();
  });

  filtersForm?.addEventListener("change", () => {
    refreshCollection();
  });

  filtersForm?.querySelectorAll('input[type="number"]').forEach((input) => {
    input.addEventListener("input", refreshCollection);
  });

  sortForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    refreshCollection();
  });

  sortForm?.addEventListener("change", () => {
    refreshCollection();
  });

  applyClientSearch();
  initInfiniteScroll();
};

const initCollections = (scope = document) => {
  scope.querySelectorAll("[data-rp-collection-root]").forEach((root) => initCollectionSection(root));
};

const initPredictiveSearch = () => {
  const panel = document.querySelector("[data-rp-search-panel]");
  const openers = document.querySelectorAll("[data-rp-search-open]");
  const closers = document.querySelectorAll("[data-rp-search-close]");
  const input = panel?.querySelector("[data-rp-predictive-input]");
  const results = panel?.querySelector("[data-rp-predictive-results]");

  if (!panel || !input || !results || openers.length === 0) return;

  let firstResultUrl = "";
  let searchOpener = null;

  const openPanel = (opener) => {
    searchOpener = opener || null;
    const cartDrawer = document.querySelector("[data-rp-cart-drawer]");

    if (cartDrawer) {
      setHiddenState(cartDrawer, true);
    }

    document.body.classList.remove("rp-cart-open");
    setHiddenState(panel, false);
    document.body.classList.add("rp-search-open");
    window.requestAnimationFrame(() => { input.focus(); trapFocus(panel); });
  };

  const closePanel = () => {
    setHiddenState(panel, true);
    document.body.classList.remove("rp-search-open");
    releaseFocus(searchOpener);
    searchOpener = null;
  };

  const setSearchState = (markup, { loading = false } = {}) => {
    results.innerHTML = markup;
    results.classList.toggle("is-loading", loading);
  };

  const renderProducts = (products) => {
    firstResultUrl = products[0]?.url || "";

    if (products.length === 0) {
      setSearchState('<p class="rp-search-panel__state">No matching dresses yet. Try a different title, colour, or silhouette.</p>');
      return;
    }

    setSearchState(
      `<div class="rp-search-panel__list">${products
        .map((product) => {
          const image = product.featured_image?.url || product.image || "";
          const price = product.price ? formatMoney(Number(product.price)) : "";

          return `
            <a class="rp-search-panel__item" href="${escapeHtml(product.url)}">
              <span class="rp-search-panel__item-media">
                ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(product.title)}" loading="lazy">` : ""}
              </span>
              <span class="rp-search-panel__item-copy">
                <strong>${escapeHtml(product.title)}</strong>
                <span>${escapeHtml(product.vendor || product.type || "The Re:P Club")}</span>
              </span>
              ${price ? `<span class="rp-search-panel__item-price">${escapeHtml(price)}</span>` : ""}
            </a>
          `;
        })
        .join("")}</div>`
    );
  };

  const runSearch = debounce(async () => {
    const query = input.value.trim();

    if (query.length < 2) {
      firstResultUrl = "";
      setSearchState('<p class="rp-search-panel__state">Search results will appear here.</p>');
      return;
    }

    if (predictiveSearchCache.has(query)) {
      renderProducts(predictiveSearchCache.get(query));
      return;
    }

    setSearchState('<p class="rp-search-panel__state">Searching the edit...</p>', { loading: true });

    try {
      const response = await fetch(
        `${shopifyRoot}search/suggest.json?q=${encodeURIComponent(query)}&resources[type]=product&resources[limit]=6&resources[options][unavailable_products]=last`,
        {
          headers: {
            Accept: "application/json",
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Predictive search failed with ${response.status}`);
      }

      const suggestions = await response.json();
      const products = suggestions?.resources?.results?.products || [];

      cachePredictiveSearch(query, products);
      renderProducts(products);
    } catch (error) {
      console.error(error);
      firstResultUrl = "";
      setSearchState('<p class="rp-search-panel__state">Search is unavailable right now. Please try again in a moment.</p>');
    }
  }, 220);

  openers.forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      openPanel(button);
    });
  });

  closers.forEach((button) => {
    button.addEventListener("click", closePanel);
  });

  input.addEventListener("input", runSearch);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && firstResultUrl) {
      event.preventDefault();
      window.location.href = firstResultUrl;
    }
  });

};

const initCartDrawer = () => {
  const drawer = document.querySelector("[data-rp-cart-drawer]");
  const openers = document.querySelectorAll("[data-rp-cart-open]");
  const closers = document.querySelectorAll("[data-rp-cart-close]");
  const content = drawer?.querySelector("[data-rp-cart-content]");
  const subtotal = drawer?.querySelector("[data-rp-cart-subtotal]");
  const countBadges = document.querySelectorAll("[data-rp-cart-count]");

  if (!drawer || !content || !subtotal || openers.length === 0) return;

  const updateCountBadges = (count) => {
    countBadges.forEach((badge) => {
      badge.textContent = String(count);
      badge.classList.toggle("is-empty", count === 0);
    });
  };

  let cartOpener = null;

  const openDrawer = (opener) => {
    if (opener !== undefined) cartOpener = opener;
    const searchPanel = document.querySelector("[data-rp-search-panel]");

    if (searchPanel) {
      setHiddenState(searchPanel, true);
    }

    document.body.classList.remove("rp-search-open");
    setHiddenState(drawer, false);
    document.body.classList.add("rp-cart-open");
    window.requestAnimationFrame(() => {
      const firstFocusable = drawer.querySelector(FOCUSABLE);
      firstFocusable?.focus();
      trapFocus(drawer);
    });
  };

  const closeDrawer = () => {
    setHiddenState(drawer, true);
    document.body.classList.remove("rp-cart-open");
    releaseFocus(cartOpener);
    cartOpener = null;
  };

  const BOOKING_KEY_PATTERNS = ["date", "start", "end", "duration", "days", "arrival", "return", "from", "to", "period", "window", "rental"];
  const isBookingKey = (key) => BOOKING_KEY_PATTERNS.some((p) => key.toLowerCase().includes(p));

  const renderPropertyRow = ([key, value]) => `
    <div class="rp-cart-drawer__property">
      <dt>${escapeHtml(key)}</dt>
      <dd>${escapeHtml(value)}</dd>
    </div>
  `;

  const renderProperties = (properties = {}) => {
    const items = Object.entries(properties).filter(([key, value]) => value && !key.startsWith("_"));

    if (items.length === 0) return "";

    const bookingItems = items.filter(([key]) => isBookingKey(key));
    const otherItems = items.filter(([key]) => !isBookingKey(key));

    const bookingSection = bookingItems.length > 0
      ? `<div class="rp-cart-drawer__booking">
           <p class="rp-cart-drawer__booking-label">Booking window</p>
           <dl class="rp-cart-drawer__properties">${bookingItems.map(renderPropertyRow).join("")}</dl>
         </div>`
      : "";

    const otherSection = otherItems.length > 0
      ? `<dl class="rp-cart-drawer__properties">${otherItems.map(renderPropertyRow).join("")}</dl>`
      : "";

    return bookingSection + otherSection;
  };

  const renderCart = (cart) => {
    updateCountBadges(cart.item_count || 0);
    subtotal.textContent = formatMoney(cart.total_price, cart.currency);

    if (!cart.items || cart.items.length === 0) {
      content.innerHTML = `
        <div class="rp-cart-drawer__empty">
          <p>Your cart is still empty.</p>
          <a class="rp-button rp-button--solid" href="${shopifyRoot}collections/all">Browse dresses</a>
        </div>
      `;
      return;
    }

    content.innerHTML = `
      <div class="rp-cart-drawer__items">
        ${cart.items
          .map((item) => {
            const image = item.featured_image?.url || item.image || "";
            const title = item.product_title || item.title || "Dress";
            const linePrice = formatMoney(item.final_line_price, cart.currency);
            const variantTitle = item.variant_title ? `<p class="rp-cart-drawer__variant">${escapeHtml(item.variant_title)}</p>` : "";

            return `
              <article class="rp-cart-drawer__item">
                <a class="rp-cart-drawer__item-media" href="${escapeHtml(item.url || "/cart")}">
                  ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(title)}" loading="lazy">` : ""}
                </a>
                <div class="rp-cart-drawer__item-copy">
                  <div class="rp-cart-drawer__item-head">
                    <h3><a href="${escapeHtml(item.url || "/cart")}">${escapeHtml(title)}</a></h3>
                    <span>${escapeHtml(linePrice)}</span>
                  </div>
                  ${variantTitle}
                  ${renderProperties(item.properties)}
                  <div class="rp-cart-drawer__item-actions">
                    <label class="rp-cart-drawer__quantity">
                      <span class="visually-hidden">Units for ${escapeHtml(title)}</span>
                      <input type="number" min="0" value="${Number(item.quantity) || 0}" data-rp-cart-line-key="${escapeHtml(item.key)}" data-rp-cart-quantity>
                    </label>
                    <button type="button" class="rp-cart-drawer__remove" data-rp-cart-remove data-rp-cart-line-key="${escapeHtml(item.key)}">Remove</button>
                  </div>
                </div>
              </article>
            `;
          })
          .join("")}
      </div>
    `;
  };

  const loadCart = async ({ open = false } = {}) => {
    content.innerHTML = '<p class="rp-cart-drawer__state">Loading your cart...</p>';

    try {
      const response = await fetch(`${shopifyRoot}cart.js`, {
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Cart fetch failed with ${response.status}`);
      }

      const cart = await response.json();
      renderCart(cart);

      if (open) {
        openDrawer();
      }
    } catch (error) {
      console.error(error);
      content.innerHTML = '<p class="rp-cart-drawer__state">The cart is unavailable right now. Please try again.</p>';
    }
  };

  const updateCartLine = async (key, quantity) => {
    try {
      const response = await fetch(`${shopifyRoot}cart/change.js`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          id: key,
          quantity,
        }),
      });

      if (!response.ok) {
        throw new Error(`Cart change failed with ${response.status}`);
      }

      const cart = await response.json();
      renderCart(cart);
    } catch (error) {
      console.error(error);
      loadCart();
    }
  };

  openers.forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      cartOpener = link;
      loadCart({ open: true });
    });
  });

  closers.forEach((button) => {
    button.addEventListener("click", closeDrawer);
  });

  drawer.addEventListener("change", (event) => {
    const quantityInput = event.target.closest("[data-rp-cart-quantity]");

    if (!quantityInput) return;

    const quantity = Math.max(0, Number.parseInt(quantityInput.value, 10) || 0);
    updateCartLine(quantityInput.dataset.rpCartLineKey, quantity);
  });

  drawer.addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-rp-cart-remove]");

    if (!removeButton) return;

    updateCartLine(removeButton.dataset.rpCartLineKey, 0);
  });

  document.addEventListener(
    "submit",
    async (event) => {
      const form = event.target;

      if (!(form instanceof HTMLFormElement)) return;
      if (!form.action || !form.action.includes("/cart/add")) return;

      event.preventDefault();

      try {
        const response = await fetch(`${shopifyRoot}cart/add.js`, {
          method: "POST",
          body: new FormData(form),
        });

        if (!response.ok) {
          throw new Error(`Cart add failed with ${response.status}`);
        }

        await response.json();
        await new Promise((resolve) => window.setTimeout(resolve, 120));
        await loadCart({ open: true });
      } catch (error) {
        console.error(error);
      }
    },
    true
  );

  loadCart();
};

const initProductZoom = () => {
  const lightbox = document.querySelector("[data-rp-lightbox]");
  const image = lightbox?.querySelector("[data-rp-lightbox-image]");
  const closers = lightbox?.querySelectorAll("[data-rp-lightbox-close]") || [];
  const triggers = document.querySelectorAll("[data-rp-zoomable]");

  if (!lightbox || !image || triggers.length === 0) return;

  let lightboxOpener = null;

  const openLightbox = (sourceImage, opener) => {
    lightboxOpener = opener || null;
    image.src = sourceImage.currentSrc || sourceImage.src || "";
    image.alt = sourceImage.alt || "";
    lightbox.hidden = false;
    document.body.classList.add("rp-lightbox-open");
    window.requestAnimationFrame(() => {
      const closeBtn = lightbox.querySelector("[data-rp-lightbox-close]");
      closeBtn?.focus();
      trapFocus(lightbox);
    });
  };

  const closeLightbox = () => {
    lightbox.hidden = true;
    document.body.classList.remove("rp-lightbox-open");
    releaseFocus(lightboxOpener);
    lightboxOpener = null;
  };

  triggers.forEach((trigger) => {
    const imageNode = trigger.querySelector("img");

    if (!imageNode) return;

    trigger.addEventListener("click", () => openLightbox(imageNode, trigger));
    trigger.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openLightbox(imageNode, trigger);
      }
    });
  });

  closers.forEach((button) => button.addEventListener("click", closeLightbox));

};

const getRecentProducts = () => {
  try {
    return JSON.parse(window.localStorage.getItem(recentProductsStorageKey) || "[]");
  } catch (error) {
    return [];
  }
};

const setRecentProducts = (products) => {
  try {
    window.localStorage.setItem(recentProductsStorageKey, JSON.stringify(products));
  } catch (error) {
    console.error(error);
  }
};

const initRecentlyViewed = () => {
  const productJson = document.querySelector("[data-rp-product-json]");
  const section = document.querySelector("[data-rp-recently-viewed]");
  const list = section?.querySelector("[data-rp-recently-list]");

  if (!productJson || !section || !list) return;

  let currentProduct;

  try {
    currentProduct = JSON.parse(productJson.textContent);
  } catch (error) {
    console.error(error);
    return;
  }

  const recentProducts = getRecentProducts().filter((product) => product.id !== currentProduct.id);
  const updatedProducts = [currentProduct, ...recentProducts].slice(0, 8);

  setRecentProducts(updatedProducts);

  const renderableProducts = updatedProducts.filter((product) => product.id !== currentProduct.id).slice(0, 4);

  if (renderableProducts.length === 0) {
    section.hidden = true;
    return;
  }

  section.hidden = false;
  list.innerHTML = renderableProducts
    .map(
      (product) => `
        <article class="rp-product-card rp-product-card--recent" data-rp-recent-card>
          <a class="rp-product-card__link" href="${escapeHtml(product.url)}">
            <div class="rp-product-card__media">
              ${product.image ? `<img class="rp-product-card__image rp-product-card__image--primary" src="${escapeHtml(product.image)}" alt="${escapeHtml(product.title)}" loading="lazy">` : ""}
            </div>
            <div class="rp-product-card__content">
              <div class="rp-product-card__header">
                <h3 class="rp-product-card__title">${escapeHtml(product.title)}</h3>
                <span class="rp-product-card__recent-price">${escapeHtml(product.price || "")}</span>
              </div>
              ${
                product.vendor
                  ? `<p class="rp-product-card__note">${escapeHtml(product.vendor)}</p>`
                  : '<p class="rp-product-card__note">Viewed recently</p>'
              }
            </div>
          </a>
        </article>
      `
    )
    .join("");
};

const initCartPage = () => {
  const form = document.querySelector("[data-rp-cart-page]");

  if (!form) return;

  const subtotalEl = form.querySelector("[data-rp-cart-subtotal]");
  const totalEl = form.querySelector("[data-rp-cart-total]");
  let busy = false;

  const setPageLoading = (loading) => {
    form.classList.toggle("is-loading", loading);
    busy = loading;
  };

  const updateTotals = (cart) => {
    if (subtotalEl) subtotalEl.textContent = formatMoney(cart.items_subtotal_price, cart.currency);
    if (totalEl) totalEl.textContent = formatMoney(cart.total_price, cart.currency);

    cart.items.forEach((item) => {
      const priceEl = form.querySelector(`[data-rp-line-price="${item.key}"]`);
      if (priceEl) priceEl.textContent = formatMoney(item.final_line_price, cart.currency);
      const qtyEl = form.querySelector(`[data-rp-cart-qty][data-line-key="${item.key}"]`);
      if (qtyEl) qtyEl.value = String(item.quantity);
    });
  };

  const changeCartLine = async (key, quantity) => {
    if (busy) return;
    setPageLoading(true);

    try {
      const response = await fetch(`${shopifyRoot}cart/change.js`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ id: key, quantity }),
      });

      if (!response.ok) throw new Error(`Cart change failed: ${response.status}`);

      const cart = await response.json();
      updateTotals(cart);

      if (quantity === 0) {
        const row = form.querySelector(`[data-rp-cart-qty][data-line-key="${key}"]`)?.closest("[data-rp-reveal]");
        if (row) {
          row.style.transition = "opacity 240ms ease, transform 240ms ease";
          row.style.opacity = "0";
          row.style.transform = "translateY(-8px)";
          window.setTimeout(() => row.remove(), 250);
        }
      }
    } catch (error) {
      console.error(error);
    } finally {
      setPageLoading(false);
    }
  };

  form.addEventListener("change", debounce((event) => {
    const input = event.target.closest("[data-rp-cart-qty]");
    if (!input) return;
    const qty = Math.max(0, Number.parseInt(input.value, 10) || 0);
    changeCartLine(input.dataset.lineKey, qty);
  }, 400));

  form.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-rp-cart-remove]");
    if (!btn) return;
    changeCartLine(btn.dataset.lineKey, 0);
  });
};

const initVariantPills = () => {
  document.querySelectorAll("[data-rp-variant-field]").forEach((field) => {
    const pills = Array.from(field.querySelectorAll("[data-rp-variant-pill]"));
    const idInput = field.querySelector("[data-rp-variant-id-input]");
    const form = field.closest("form");
    const submitBtn = form?.querySelector(".rp-rental-widget-shell__submit");

    if (!pills.length || !idInput) return;

    pills.forEach((pill) => {
      pill.addEventListener("click", () => {
        const available = pill.dataset.variantAvailable !== "false";

        pills.forEach((p) => {
          p.classList.remove("is-active");
          p.setAttribute("aria-pressed", "false");
        });
        pill.classList.add("is-active");
        pill.setAttribute("aria-pressed", "true");

        idInput.value = pill.dataset.variantId;

        if (submitBtn) {
          submitBtn.disabled = !available;
          submitBtn.textContent = available ? "Add booking to bag" : "Sold out";
        }
      });
    });
  });
};

document.addEventListener("DOMContentLoaded", () => {
  initHeader();
  initAnnouncementRotation();
  initDecorativeVideos();
  initReveal();
  initAccordions();
  initFilters();
  initMobileMenu();
  initCarousels();
  initCollections();
  initPredictiveSearch();
  initCartDrawer();
  initProductZoom();
  initRecentlyViewed();
  initVariantPills();
  initCartPage();

  document.querySelectorAll("[data-rp-search-panel], [data-rp-cart-drawer], [data-rp-lightbox]").forEach((panel) => {
    if (panel.hidden) {
      panel.setAttribute("aria-hidden", "true");
    }
  });

  document.addEventListener("keyup", (event) => {
    if (event.key === "Escape") {
      closeTopOverlay();
    }
  });
});
