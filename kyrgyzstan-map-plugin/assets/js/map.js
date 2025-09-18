document.addEventListener('DOMContentLoaded', () => {
    const map = L.map('map', {
        crs: L.CRS.Simple,
        minZoom: -1,
        maxZoom: 5,
        zoomSnap: 0.25,
        zoomDelta: 0.5,
        zoomControl: true,
        attributionControl: false
    });

    let svgW = 1000, svgH = 1000;
    let countryBounds = [[0, 0], [svgH, svgW]];
    let marker = null;
    let titleMarker = null;
    const labelsLayer = L.layerGroup().addTo(map);
    let features = [];
    let currentZoomLevel = map.getZoom();

    map.dragging.enable();
    map.scrollWheelZoom.enable();
    map.keyboard.enable();
    map.doubleClickZoom.enable();

    // Объект с русскими названиями отраслей
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

    // --- утилиты ---
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

    function clearLabels() {
        labelsLayer.clearLayers();
    }

    function addLabel(name, latlng) {
        const icon = L.divIcon({
            className: 'kmap-label',
            html: `<div class="kmap-label__inner">${name}</div>`
        });
        L.marker(latlng, { icon, interactive: false }).addTo(labelsLayer);
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
                </div>
            `;
        }
        
        html += '</div>';
        return html || '<div class="no-data">Нет данных</div>';
    }

    // --- парсер нового id ---
    function parsePathId(idString) {
        const obj = {};
        idString.split(';').forEach(pair => {
            const [key, ...rest] = pair.split('=');
            obj[key] = rest.join('=');
        });
        return obj;
    }

    function paintPathBase(path) {
        const attrs = parsePathId(path.getAttribute('id') || '');
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

    // Функция для определения отображаемых меток в зависимости от зума
    function updateLabelsByZoom() {
        clearLabels();
        const zoom = map.getZoom();
        
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

    // Функция для отображение меток определенного уровня
    function showLabelsByLevel(level) {
        features.forEach(feature => {
            if (feature.level === level && feature.name) {
                addLabel(feature.name, feature.center);
            }
        });
    }

    // Функция для загрузки статистики по Кыргызстану
    function loadKyrgyzstanStats() {
        fetch(`${kmapData.ajaxurl}?action=kmap_get_stats&level=country&name=Кыргызстан&code=`)
            .then(r => r.json())
            .then(data => {
                document.getElementById('stats-title').textContent = 'Кыргызстан';
                document.getElementById('stats-content').innerHTML = formatStats(data);
                document.getElementById('ayyl-list').innerHTML = '';
                
                // Центрируем карту на всей стране
                map.fitBounds(countryBounds, { padding: [50, 50] });
                
                // Убираем маркеры, если они есть
                if (marker) {
                    map.removeLayer(marker);
                    marker = null;
                }
                if (titleMarker) {
                    map.removeLayer(titleMarker);
                    titleMarker = null;
                }
            })
            .catch(err => console.error('Ошибка загрузки статистики по Кыргызстану:', err));
    }

    function attachPathHandlers(path, overlayRoot) {
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
            const attrs = parsePathId(el.getAttribute('id') || '');
            const name = attrs.display_name || 'Без названия';
            const level = attrs.level || 'unknown';
            const code = attrs.code || '';
            
            console.log(`Клик: level=${level}, code=${code}, name=${name}`);
            
            fetch(`${kmapData.ajaxurl}?action=kmap_get_stats&level=${level}&name=${encodeURIComponent(name)}&code=${encodeURIComponent(code)}`)
                .then(r => r.json())
                .then(data => {
                    document.getElementById('stats-title').textContent = name;
                    document.getElementById('stats-content').innerHTML = formatStats(data);
                    
                    const b = getBoundsFromPath(el);
                    map.fitBounds(b, { padding: [20, 20] });
                    const center = centerOfBounds(b);
                    
                    if (marker) map.removeLayer(marker);
                    marker = L.marker(center).addTo(map);
                    setTitleMarker(name, center);
                    
                    if (level === 'district') {
                        fetch(`${kmapData.ajaxurl}?action=kmap_get_ayyl_aymaks&district=${encodeURIComponent(name)}&code=${encodeURIComponent(code)}`)
                            .then(r => r.json())
                            .then(ayylList => {
                                if (ayylList.length === 0) {
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
                                        // Убираем активный класс у всех элементов
                                        document.querySelectorAll('.ayyl-item').forEach(i => i.classList.remove('active'));
                                        // Добавляем активный класс к текущему элементу
                                        item.classList.add('active');
                                        
                                        const stats = JSON.parse(item.dataset.stats || '{}');
                                        document.getElementById('stats-content').innerHTML = formatStats(stats);
                                        document.getElementById('stats-title').textContent = item.dataset.name;
                                    });
                                });
                            })
                            .catch(err => {
                                console.error('Ошибка загрузки айыл аймаков:', err);
                                document.getElementById('ayyl-list').innerHTML = '';
                            });
                    } else {
                        document.getElementById('ayyl-list').innerHTML = '';
                    }
                    
                    updateLabelsByZoom();
                })
                .catch(err => console.error('Ошибка загрузки статистики:', err));
        });
    }

    // Обработчик изменения зума
    map.on('zoomend', () => {
        currentZoomLevel = map.getZoom();
        updateLabelsByZoom();
    });

    // Загружаем статистику по Кыргызстану при инициализации
    loadKyrgyzstanStats();

    fetch(kmapData.mapUrl)
        .then(r => r.text())
        .then(svgText => {
            const parser = new DOMParser();
            const svgDoc = parser.parseFromString(svgText, 'image/svg+xml');
            const svgEl = svgDoc.documentElement;
            const vb = (svgEl.getAttribute('viewBox') || '0 0 1000 1000').split(/\s+/).map(Number);
            svgW = vb[2] || 1000;
            svgH = vb[3] || 1000;
            countryBounds = [[0, 0], [svgH, svgW]];
            
            const overlay = L.svgOverlay(svgEl, countryBounds, {
                interactive: true,
                className: 'kmap-svg'
            }).addTo(map);
            
            map.fitBounds(countryBounds, { padding: [50, 50] });
            
            const overlayRoot = overlay.getElement();
            
            overlayRoot.querySelectorAll('path').forEach(path => {
                paintPathBase(path);
                
                const attrs = parsePathId(path.getAttribute('id') || '');
                const b = getBoundsFromPath(path);
                const center = centerOfBounds(b);
                
                features.push({
                    level: attrs.level,
                    name: attrs.display_name,
                    center: center,
                    element: path
                });
                
                attachPathHandlers(path, overlayRoot);
            });
            
            updateLabelsByZoom();
        })
        .catch(err => console.error('Ошибка загрузки SVG:', err));
});