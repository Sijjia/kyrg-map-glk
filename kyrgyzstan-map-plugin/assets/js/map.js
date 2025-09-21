document.addEventListener('DOMContentLoaded', () => {
  const map = L.map('map', {
    crs: L.CRS.Simple,
    minZoom: -1,
    maxZoom: 5,
    zoomSnap: 0.25,
    zoomDelta: 0.5,
    zoomControl: true,
    attributionControl: false,
    scrollWheelZoom: false,   // запрет колесика
    touchZoom: false,         // запрет пинча
    doubleClickZoom: false,   // запрет даблклика
    boxZoom: false
  });

  // ====== состояние ======
  let svgW = 1000, svgH = 1000;
  let countryBounds = [[0, 0], [svgH, svgW]];
  let overlay = null;          // ВАЖНО: глобальный overlay, чтобы снимать и подменять
  let marker = null;
  let titleMarker = null;
  const labelsLayer = L.layerGroup().addTo(map);
  let features = [];
  let currentZoomLevel = map.getZoom();
  let currentView = 'adm1'; // 'adm1' или 'adm2'             // общий overlay, чтобы снимать/подменять
  let selectedPin = null;          // метка выбранного района

  // можно таскать карту
  map.dragging.enable();

  // ====== словари/утилиты ======
  const industryNames = {
    'agriculture': 'Сельское хозяйство',
    'processing': 'Перерабатывающая промышленность',
    'transport': 'Транспорт и логистика',
    'construction': 'Строительство и инфраструктура',
    'industry': 'Промышленность',
    'energy': 'Энергетика и ВИЭ',
    'education': 'Образование',
    'healthcare': 'Здравоохранение'
  };

  function ensureBackButton() {
    let btn = document.getElementById('kmap-back');
    const mapEl = document.getElementById('map');

        if (!btn && mapEl) {
            // создаём кнопку программно
            btn = document.createElement('button');
            btn.id = 'kmap-back';
            btn.type = 'button';
            btn.textContent = '← Назад к областям';
            btn.className = 'absolute top-3 left-3 bg-white/95 text-black px-3 py-1 rounded-md shadow text-sm hover:bg-white';
            // начально скрыта
            btn.style.display = 'none';
            // чтобы абсолютная кнопка позиционировалась относительно карты
            mapEl.classList.add('relative');
            mapEl.appendChild(btn);
        }

        if (btn && !btn._kmapBound) {
            btn.onclick = () => { loadADM1(); };
            btn._kmapBound = true; // чтобы не вешать повторно
        }

        // всегда держим поверх
        if (btn) btn.style.zIndex = '1000';
        return btn;
    }

  function parsePathId(idString) {
    const obj = {};
    (idString || '').split(';').forEach(pair => {
      if (!pair) return;
      const [key, ...rest] = pair.split('=');
      obj[key] = rest.join('=');
    });
    return obj;
  }

  function getBoundsFromPath(path) {
    const box = path.getBBox();
    const y1 = svgH - (box.y + box.height);
    const y2 = svgH - box.y;
    const x1 = box.x;
    const x2 = box.x + box.width;
    return [[y1, x1], [y2, x2]];
  }
  function centerOfBounds(b) {
    return [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2];
  }

  function clearLabels() { labelsLayer.clearLayers(); }
  function addLabel(name, latlng) {
    const pin = L.marker(latlng, { opacity: 0, interactive: false }).addTo(labelsLayer);
    pin.bindTooltip(name, { permanent: true, direction: 'center', className: 'kmap-label' }).openTooltip();
  }

  function setTitleMarker(name, latlng) {
    if (titleMarker) map.removeLayer(titleMarker);
    titleMarker = L.marker(latlng, { opacity: 0 })
      .addTo(map)
      .bindTooltip(name, {
        permanent: true,
        direction: 'top',
        offset: [0, -6],
        className: 'kmap-title'
      })
      .openTooltip();
  }

  function formatStats(data) {
    if (!data || typeof data !== 'object') return '<div class="no-data">Нет данных</div>';
    let html = '<div class="stats-grid">';
    for (const industry in data) {
      const v = data[industry] || {};
      const industryName = industryNames[industry] || industry;
      html += `
        <div class="industry-card">
          <h4 class="industry-title">${industryName}</h4>
          <div class="stats-row">
            <span class="stat-label">Сумма лизинга:</span>
            <span class="stat-value">${v.leasing_amount ?? 0} млн сом</span>
          </div>
          <div class="stats-row">
            <span class="stat-label">Количество техники:</span>
            <span class="stat-value">${v.equipment_quantity ?? 0}</span>
          </div>
          <div class="stats-row">
            <span class="stat-label">Новые рабочие места:</span>
            <span class="stat-value">${v.new_jobs ?? 0}</span>
          </div>
        </div>`;
    }
    html += '</div>';
    return html || '<div class="no-data">Нет данных</div>';
  }

  function paintPathBase(path) {
    const attrs = parsePathId((path.closest('[id]') || path).getAttribute('id') || '');
    const isRegion = (attrs.level === 'region');
    const isBishkek = (attrs.data_bishkek === 'true');
    const base = (isRegion && isBishkek) ? '#1e3a8a' : '#022068';
    path.style.fill = base;
    path.dataset.defFill = base;
    path.style.cursor = 'pointer';
    path.style.stroke = '#fff';
    path.style.strokeWidth = '0.5';
    path.style.pointerEvents = 'all';
  }

  function updateLabelsByZoom() {
    clearLabels();
    const zoom = map.getZoom();

    // На уровне районов (adm2) всегда показываем подписи РАЙОНОВ
    if (currentView === 'adm2') {
        showLabelsByLevel('district');
        return;
    }

    // На уровне областей (adm1) — как раньше
    if (zoom < 1) {
        showLabelsByLevel('region');
    } else if (zoom >= 1 && zoom < 2.5) {
        showLabelsByLevel('district');
    } else if (zoom >= 2.5 && zoom < 4) {
        showLabelsByLevel('region');
        showLabelsByLevel('district');
    } else {
        clearLabels();
    }
    }
  function showLabelsByLevel(level) {
    features.forEach(feature => {
      if (feature.level === level && feature.name) addLabel(feature.name, feature.center);
    });
  }

  // Функция «поставить метку на выбранный район»
  function placeSelectedPin(name, latlng) {
  if (selectedPin) { map.removeLayer(selectedPin); selectedPin = null; }
  selectedPin = L.marker(latlng, {
    icon: L.divIcon({
      className: 'kmap-selected-pin',
      html: '<div style="width:12px;height:12px;border-radius:50%;background:#fff;border:3px solid #CA9E67;box-shadow:0 0 0 2px #022068;"></div>',
      iconSize: [18, 18],
      iconAnchor: [9, 9]
    })
  }).addTo(map);
  selectedPin.bindTooltip(name, { permanent: false, direction: 'top', offset: [0, -10], className: 'kmap-label' });
    }

  // ====== загрузка стартовой статистики ======
  function loadKyrgyzstanStats() {
    fetch(`${kmapData.ajaxurl}?action=kmap_get_stats&level=country&name=Кыргызстан&code=`)
      .then(r => r.json())
      .then(data => {
        document.getElementById('stats-title').textContent = 'Кыргызстан';
        document.getElementById('stats-content').innerHTML = formatStats(data);
        document.getElementById('ayyl-list').innerHTML = '';
        map.fitBounds(countryBounds, { padding: [50, 50] });
        if (marker) { map.removeLayer(marker); marker = null; }
        if (titleMarker) { map.removeLayer(titleMarker); titleMarker = null; }
      })
      .catch(err => console.error('Ошибка загрузки статистики по Кыргызстану:', err));
  }

  // ====== attach для ОБЛАСТЕЙ (ADM1) ======
  function attachRegionHandlers(path, overlayRoot) {
    path.addEventListener('mouseover', (e) => {
      e.stopImmediatePropagation();
      e.currentTarget.style.fill = '#CA9E67';
    });
    path.addEventListener('mouseout', (e) => {
      e.stopImmediatePropagation();
      const p = e.currentTarget;
      p.style.fill = p.dataset.defFill || '#022068';
    });
    path.addEventListener('click', (e) => {
      e.stopImmediatePropagation();
      const el = e.currentTarget;
      const carrier = el.closest('[id]') || el;
      const attrs = parsePathId(carrier.getAttribute('id') || '');
      const regionName = attrs.display_name || '';
      const level = attrs.level || 'region';

      // Обновим панель статистики по области
      fetch(`${kmapData.ajaxurl}?action=kmap_get_stats&level=${level}&name=${encodeURIComponent(regionName)}&code=`)
        .then(r => r.json())
        .then(data => {
          document.getElementById('stats-title').textContent = regionName;
          document.getElementById('stats-content').innerHTML = formatStats(data);
        })
        .catch(() => {});

      // Подгрузить карту районов для этой области
      const adm2Url = (kmapData.adm2Map || {})[regionName];
      if (!adm2Url) return;

      loadADM2(adm2Url);
      // Показать кнопку "Назад", если она есть в разметке
      const backBtn = document.getElementById('kmap-back');
      if (backBtn) backBtn.classList.remove('hidden');
    });
  }

  // ====== attach для РАЙОНОВ (ADM2) ======
  function attachDistrictHandlers(path) {
    path.style.fill = '#022068';
    path.style.stroke = '#fff';
    path.style.strokeWidth = '0.5';
    path.style.cursor = 'pointer';

    path.addEventListener('mouseover', () => path.style.fill = '#CA9E67');
    path.addEventListener('mouseout', () => {
      // если не активный — вернуть цвет
      if (!path.classList.contains('active-district')) path.style.fill = '#022068';
    });

    path.addEventListener('click', () => {
        const a = parsePathId((path.closest('[id]') || path).getAttribute('id') || '');
        const districtName = a.display_name || 'Район';

        // Подсветка выбранного
        if (overlay) {
            overlay.getElement().querySelectorAll('path').forEach(p => {
            p.classList.remove('active-district');
            p.style.fill = '#022068';
            });
        }
        path.classList.add('active-district');
        path.style.fill = '#CA9E67';

        // >>> добавь эти 3 строки — вычисляем центр района и ставим пин
        const bounds = getBoundsFromPath(path);
        const center = centerOfBounds(bounds);
        placeSelectedPin(districtName, center);
        // <<<

        // Статистика по району
        fetch(`${kmapData.ajaxurl}?action=kmap_get_stats&level=district&name=${encodeURIComponent(districtName)}&code=`)
            .then(r => r.json())
            .then(data => {
            document.getElementById('stats-title').textContent = districtName;
            document.getElementById('stats-content').innerHTML = formatStats(data);
            })
            .catch(() => {});

        // Список аймаков
        fetch(`${kmapData.ajaxurl}?action=kmap_get_ayyl_aymaks&district=${encodeURIComponent(districtName)}&code=`)
            .then(r => r.json())
            .then(ayylList => {
            if (!Array.isArray(ayylList) || ayylList.length === 0) {
                document.getElementById('ayyl-list').innerHTML = '';
                return;
            }
            let html = `
                <div class="ayyl-list-container">
                <h3 class="ayyl-list-title">Айыл аймактары района:</h3>
                <div class="ayyl-scroll-container">
            `;
            ayylList.forEach(ayyl => {
                const ds = ayyl.stats ? JSON.stringify(ayyl.stats).replace(/"/g, '&quot;') : '{}';
                html += `
                <div class="ayyl-item" data-stats="${ds}" data-name="${ayyl.name}">
                    <span class="ayyl-name">${ayyl.name}</span>
                    <span class="ayyl-stats-badge">${ayyl.stats ? '📊' : ''}</span>
                </div>`;
            });
            html += '</div></div>';
            document.getElementById('ayyl-list').innerHTML = html;

            document.querySelectorAll('.ayyl-item').forEach(item => {
                item.addEventListener('click', () => {
                document.querySelectorAll('.ayyl-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                const stats = JSON.parse(item.dataset.stats || '{}');
                document.getElementById('stats-content').innerHTML = formatStats(stats);
                document.getElementById('stats-title').textContent = item.dataset.name;
                });
            });
            })
            .catch(() => {
            document.getElementById('ayyl-list').innerHTML = '';
            });
        });
  }

  // ====== загрузчики слоёв ======
  function mountOverlayFromSVGText(svgText, onEachPath) {
    if (overlay) { map.removeLayer(overlay); overlay = null; }
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const svgEl = doc.documentElement;
    const vb = (svgEl.getAttribute('viewBox') || '0 0 1000 1000').split(/\s+/).map(Number);
    svgW = vb[2] || 1000;
    svgH = vb[3] || 1000;
    countryBounds = [[0, 0], [svgH, svgW]];
    overlay = L.svgOverlay(svgEl, countryBounds, { interactive: true, className: 'kmap-svg' }).addTo(map);
    map.fitBounds(countryBounds, { padding: [50, 50] });

    const overlayRoot = overlay.getElement();
    features = []; // пересоберём для лейблов

    overlayRoot.querySelectorAll('path').forEach(path => {
      const idCarrier = (path.closest('[id]') || path);
      if (!idCarrier.getAttribute('id')) return;

      paintPathBase(path);
      const attrs = parsePathId(idCarrier.getAttribute('id') || '');
      const b = getBoundsFromPath(path);
      const center = centerOfBounds(b);

      features.push({
        level: attrs.level,
        name: attrs.display_name,
        center: center,
        element: path
      });

      if (typeof onEachPath === 'function') onEachPath(path, overlayRoot);
    });

    updateLabelsByZoom();
  }

  function loadADM1() {
    fetch(kmapData.adm1Url)
      .then(r => r.text())
      .then(svgText => {
        mountOverlayFromSVGText(svgText, (path, overlayRoot) => {
          attachRegionHandlers(path, overlayRoot);
        });

        currentView = 'adm1';
        const backBtn = ensureBackButton();
        if (backBtn) backBtn.style.display = 'none';
        updateLabelsByZoom();

        // сброс правой панели на "Кыргызстан"
        loadKyrgyzstanStats();
      })
      .catch(err => console.error('Ошибка загрузки SVG областей:', err));
  }

  function loadADM2(adm2Url) {
    fetch(adm2Url)
      .then(r => r.text())
      .then(svgText => {
        mountOverlayFromSVGText(svgText, (path /*, overlayRoot */) => {
          // для районов навешиваем другой обработчик
          attachDistrictHandlers(path);
        });

        currentView = 'adm2';
        updateLabelsByZoom();

        const backBtn = ensureBackButton();
        if (backBtn) backBtn.style.display = 'block';
      })
      .catch(err => console.error('Ошибка загрузки SVG районов:', err));
  }

  // ====== кнопка "Назад" (если есть в DOM) ======
  const backBtn = document.getElementById('kmap-back');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      loadADM1();
    });
  }

  // ====== обработчик зума (только для лейблов) ======
  map.on('zoomend', () => {
    currentZoomLevel = map.getZoom();
    updateLabelsByZoom();
  });

  // ====== старт ======
  ensureBackButton();
  loadKyrgyzstanStats();
  loadADM1();
});
