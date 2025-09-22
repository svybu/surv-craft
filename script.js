const STORAGE_KEY = "survCraftIdleSaveV1";
const AUTO_SAVE_INTERVAL = 30000;

const RESOURCE_DEFS = {
    wood: { label: "Деревина", iconKey: "woodResource" },
    stone: { label: "Камінь", iconKey: "stoneResource" },
    fiber: { label: "Волокно", iconKey: "fiberResource" },
    meat: { label: "М'ясо", iconKey: "meatResource" }
};

const JOURNAL_ENTRY_LIMIT = 40;
const ENERGY_SEGMENT_KEYS = ["slow", "medium", "fast"];
const ENERGY_SPEND_ORDER = ["fast", "medium", "slow"];

const ENERGY_SEGMENTS = {
    slow: {
        label: "Повільне відновлення",
        max: 120,
        regenRate: 0.6
    },
    medium: {
        label: "Середнє відновлення",
        max: 80,
        regenRate: 1.2
    },
    fast: {
        label: "Швидке відновлення",
        max: 40,
        regenRate: 3.1
    }
};

const GATHER_ACTIONS = [
    {
        id: "forestWood",
        name: "Пошук деревини",
        description: "Обирай здорові дерева та збирай придатні для будівництва колоди.",
        resource: "wood",
        amount: 7,
        duration: 5200,
        energyCost: 22,
        biome: "forest",
        imageKey: "forestWood"
    },
    {
        id: "forestStone",
        name: "Пошук каменю",
        description: "Малоефективний збір уламків між корінням та валунами.",
        resource: "stone",
        amount: 2,
        duration: 6600,
        energyCost: 26,
        biome: "forest",
        imageKey: "forestStone"
    },
    {
        id: "forestHunt",
        name: "Полювання",
        description: "Відстежуй здобич у хащах. Є ризик натрапити на агресивних хижаків.",
        resource: "meat",
        amount: 2,
        duration: 6800,
        energyCost: 30,
        biome: "forest",
        imageKey: "forestHunt"
    }
];

const CRAFT_ITEMS = [
    {
        id: "campfireStation",
        name: "Вогнище виживальника",
        description: "Стаціонарне вогнище для готування здобичі та обігріву бази.",
        requires: { wood: 12, stone: 4 },
        imageKey: "campfireStation"
    },
    {
        id: "carpenterBench",
        name: "Верстак теслі",
        description: "Базова майстерня для підготовки матеріалів та ремонту спорядження.",
        requires: { wood: 16, fiber: 6, stone: 2 },
        imageKey: "carpenterBench"
    },
    {
        id: "hunterRack",
        name: "Мисливська стійка",
        description: "Сушить м'ясо та шкури після вилазок до лісу.",
        requires: { wood: 10, fiber: 8, meat: 2 },
        imageKey: "hunterRack"
    }
];

const BIOMES = [
    {
        id: "base",
        name: "База виживальника",
        description: "Домівка з укріпленими укриттями та місцем для робочих станцій.",
        status: "Домівка",
        risk: "Ризик: відсутній",
        imageKey: "biomeBase",
        unlocked: true
    },
    {
        id: "forest",
        name: "Туманний ліс",
        description: "Густі зарості з деревиною, каменем і небезпекою полювання.",
        status: "Доступний",
        risk: "Ризик: середній",
        imageKey: "biomeForest",
        unlocked: true
    },
    {
        id: "crystalCaves",
        name: "Кристалічні печери",
        description: "Заглушка: глибокі печери з рідкісними мінералами та високим ризиком.",
        status: "Незабаром",
        risk: "Ризик: високий",
        imageKey: "biomeCave",
        unlocked: false
    }
];

let imagePaths = {};
let state = createDefaultState();
let saveTimeout = null;
const runningActions = new Map();
let lastEnergyTick = performance.now();

async function init() {
    state = loadState();
    await loadImagePaths();
    renderGatherActions();
    renderCraftItems();
    renderBiomes();
    renderResources();
    renderEnergy();
    renderHealth();
    renderInventory();
    renderJournal();
    if (!state.journal.length) {
        logEvent("Ви прокидаєтесь на базі виживальника.", "info");
    }
    attachControlHandlers();
    startEnergyLoop();
    setInterval(saveGame, AUTO_SAVE_INTERVAL);
}

function createDefaultState() {
    const energy = {};
    for (const [segment, config] of Object.entries(ENERGY_SEGMENTS)) {
        energy[segment] = config.max;
    }
    return {
        health: {
            current: 100,
            max: 100
        },
        energy,
        resources: {
            wood: 0,
            stone: 0,
            fiber: 0,
            meat: 0
        },
        craftedItems: {},
        currentBiome: "base",
        discoveredBiomes: ["base"],
        journal: []
    };
}

function loadState() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) {
            return createDefaultState();
        }
        const parsed = JSON.parse(stored);
        const base = createDefaultState();

        if (parsed.health) {
            base.health.current = clampNumber(parsed.health.current, 0, base.health.max);
        }

        if (parsed.energy) {
            for (const segment of Object.keys(ENERGY_SEGMENTS)) {
                const fallback = ENERGY_SEGMENTS[segment].max;
                base.energy[segment] = clampNumber(parsed.energy[segment] ?? fallback, 0, ENERGY_SEGMENTS[segment].max);
            }
        }

        if (parsed.resources) {
            for (const key of Object.keys(base.resources)) {
                base.resources[key] = Math.max(0, Number(parsed.resources[key] ?? 0));
            }
        }

        if (parsed.craftedItems) {
            base.craftedItems = Object.fromEntries(
                Object.entries(parsed.craftedItems).map(([id, amount]) => [id, Math.max(0, Number(amount))])
            );
        }

        if (typeof parsed.currentBiome === "string") {
            base.currentBiome = parsed.currentBiome;
        }

        if (Array.isArray(parsed.discoveredBiomes)) {
            base.discoveredBiomes = parsed.discoveredBiomes;
        }

        if (Array.isArray(parsed.journal)) {
            const normalized = parsed.journal
                .map((entry) => normalizeJournalEntry(entry))
                .filter(Boolean)
                .slice(0, JOURNAL_ENTRY_LIMIT);
            base.journal = normalized;
        }

        return base;
    } catch (error) {
        console.warn("Не вдалося завантажити збереження:", error);
        return createDefaultState();
    }
}

function saveGame() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
        console.warn("Не вдалося зберегти гру:", error);
    }
}

function queueSave() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveGame, 1500);
}

async function loadImagePaths() {
    try {
        const response = await fetch("image-paths.json");
        if (response.ok) {
            imagePaths = await response.json();
        } else {
            imagePaths = {};
        }
    } catch (error) {
        console.warn("Не вдалося завантажити файл із шляхами до зображень.", error);
        imagePaths = {};
    }
}

function renderGatherActions() {
    const container = document.getElementById("gatherActions");
    container.innerHTML = "";

    const available = GATHER_ACTIONS.filter((action) => action.biome === state.currentBiome);

    if (!available.length) {
        const placeholder = document.createElement("div");
        placeholder.className = "locked-message";
        placeholder.textContent =
            state.currentBiome === "base"
                ? "На базі немає активних польових дій. Вирушай до лісу за ресурсами."
                : "Дії для цієї локації ще готуються.";
        container.appendChild(placeholder);
        return;
    }

    for (const action of available) {
        const card = document.createElement("article");
        card.className = "action-card";
        card.dataset.actionId = action.id;

        const img = document.createElement("img");
        img.alt = action.name;
        img.src = resolveImagePath(action.imageKey);
        card.appendChild(img);

        const title = document.createElement("h3");
        title.textContent = action.name;
        card.appendChild(title);

        const description = document.createElement("p");
        description.textContent = action.description;
        card.appendChild(description);

        const meta = document.createElement("div");
        meta.className = "action-meta";
        meta.innerHTML = `<span>Витрата: ${action.energyCost} енергії</span><span>${(action.duration / 1000).toFixed(1)} с</span>`;
        card.appendChild(meta);

        const button = document.createElement("button");
        button.className = "action-button";
        button.type = "button";
        button.textContent = `Отримати +${action.amount} ${RESOURCE_DEFS[action.resource].label}`;
        button.addEventListener("click", () => startAction(action));
        card.appendChild(button);

        const progress = document.createElement("div");
        progress.className = "action-progress";
        progress.innerHTML = `
            <div class="progress-track">
                <div class="progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"></div>
            </div>
            <span class="progress-label">Готово до дії</span>
        `;
        card.appendChild(progress);

        container.appendChild(card);
    }
}

function startAction(action) {
    if (runningActions.has(action.id)) {
        return;
    }

    if (action.biome !== state.currentBiome) {
        showActionWarning(action.id, "Дія недоступна в цьому біомі");
        return;
    }

    const totalEnergy = getTotalEnergy();
    if (totalEnergy < action.energyCost) {
        showActionWarning(action.id, "Недостатньо енергії");
        return;
    }

    spendEnergy(action.energyCost);
    renderEnergy();

    const card = document.querySelector(`[data-action-id="${action.id}"]`);
    if (!card) {
        return;
    }

    const button = card.querySelector(".action-button");
    const progressBar = card.querySelector(".progress-bar");
    const label = card.querySelector(".progress-label");
    button.disabled = true;
    label.textContent = "Виконання... 0%";
    label.classList.remove("warning");

    const startTime = performance.now();

    const step = () => {
        const elapsed = performance.now() - startTime;
        const ratio = Math.min(elapsed / action.duration, 1);
        progressBar.style.width = `${(ratio * 100).toFixed(2)}%`;
        progressBar.setAttribute("aria-valuenow", Math.round(ratio * 100));
        label.textContent = `Виконання... ${Math.round(ratio * 100)}%`;
        if (ratio < 1) {
            const frameId = requestAnimationFrame(step);
            runningActions.get(action.id).frameId = frameId;
        }
    };

    const frameId = requestAnimationFrame(step);
    const timeoutId = window.setTimeout(
        () => completeAction(action, card, progressBar, label, button),
        action.duration
    );
    runningActions.set(action.id, { frameId, timeoutId });
    queueSave();
}

function completeAction(action, card, progressBar, label, button) {
    const trackers = runningActions.get(action.id);
    if (trackers) {
        cancelAnimationFrame(trackers.frameId);
        clearTimeout(trackers.timeoutId);
        runningActions.delete(action.id);
    }

    progressBar.style.width = "100%";
    progressBar.setAttribute("aria-valuenow", 100);
    label.classList.remove("warning");

    const gainedResources = {};
    let resourcesChanged = false;

    if (action.resource && action.amount > 0) {
        state.resources[action.resource] = (state.resources[action.resource] ?? 0) + action.amount;
        gainedResources[action.resource] = (gainedResources[action.resource] ?? 0) + action.amount;
        resourcesChanged = true;
    }

    const { events, resourcesChanged: extraResources, healthChanged, energyChanged } = applyRandomEvents(
        action,
        gainedResources
    );

    if (resourcesChanged || extraResources) {
        renderResources();
    }

    if (healthChanged) {
        renderHealth();
    }

    if (energyChanged) {
        renderEnergy();
    }

    button.disabled = false;

    const rewardText = Object.keys(gainedResources).length ? formatResourceGain(gainedResources) : "Без трофеїв";
    label.textContent = rewardText;

    const baseMessage = Object.keys(gainedResources).length
        ? `Завершено: ${action.name} — ${rewardText}.`
        : `Завершено: ${action.name}.`;
    logEvent(baseMessage, "info");
    events.forEach((event) => logEvent(event.message, event.type));

    setTimeout(() => {
        progressBar.style.width = "0%";
        progressBar.setAttribute("aria-valuenow", 0);
        label.textContent = "Готово до дії";
    }, 2200);
}

function showActionWarning(actionId, message) {
    const card = document.querySelector(`[data-action-id="${actionId}"]`);
    if (!card) {
        return;
    }
    const label = card.querySelector(".progress-label");
    label.textContent = message;
    label.classList.add("warning");
    setTimeout(() => {
        label.textContent = "Готово до дії";
        label.classList.remove("warning");
    }, 2200);
}

function getTotalEnergy() {
    return ENERGY_SEGMENT_KEYS.reduce((sum, segment) => sum + (state.energy[segment] ?? 0), 0);
}

function spendEnergy(amount) {
    let remaining = amount;
    let spent = 0;
    for (const segment of ENERGY_SPEND_ORDER) {
        if (remaining <= 0) {
            break;
        }
        const available = state.energy[segment];
        const used = Math.min(available, remaining);
        state.energy[segment] -= used;
        remaining -= used;
        spent += used;
    }
    return spent;
}

function startEnergyLoop() {
    const tick = () => {
        const now = performance.now();
        const deltaSeconds = (now - lastEnergyTick) / 1000;
        lastEnergyTick = now;
        let changed = false;

        for (const [segment, config] of Object.entries(ENERGY_SEGMENTS)) {
            const before = state.energy[segment];
            const after = Math.min(before + config.regenRate * deltaSeconds, config.max);
            if (after !== before) {
                state.energy[segment] = after;
                changed = true;
            }
        }

        if (changed) {
            renderEnergy();
            queueSave();
        }

        requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
}

function renderEnergy() {
    const totalMax = ENERGY_SEGMENT_KEYS.reduce((sum, key) => sum + ENERGY_SEGMENTS[key].max, 0);
    const totalValue = ENERGY_SEGMENT_KEYS.reduce((sum, key) => sum + (state.energy[key] ?? 0), 0);
    const totalElement = document.getElementById("energyTotal");
    if (totalElement) {
        totalElement.textContent = `${Math.round(totalValue)} / ${totalMax}`;
    }

    const track = document.querySelector(".energy-track");
    if (track) {
        const totalRatio = totalMax ? Math.round((totalValue / totalMax) * 100) : 0;
        track.setAttribute("aria-valuenow", totalRatio);
    }

    for (const segment of ENERGY_SEGMENT_KEYS) {
        const config = ENERGY_SEGMENTS[segment];
        const container = document.querySelector(`.energy-chunk[data-segment="${segment}"]`);
        if (container) {
            const fill = container.querySelector(".chunk-fill");
            if (fill) {
                const percentage = config.max
                    ? Math.max(0, Math.min(100, ((state.energy[segment] ?? 0) / config.max) * 100))
                    : 0;
                fill.style.width = `${percentage}%`;
            }
        }

        const legendValue = document.querySelector(
            `.energy-legend [data-segment="${segment}"] .legend-value`
        );
        if (legendValue) {
            legendValue.textContent = `${Math.round(state.energy[segment] ?? 0)} / ${config.max}`;
        }
    }
}

function renderResources() {
    const list = document.getElementById("resourceList");
    list.innerHTML = "";

    Object.entries(RESOURCE_DEFS).forEach(([key, meta]) => {
        const value = Math.floor(state.resources[key] ?? 0);
        const item = document.createElement("li");
        item.className = "resource-item";
        item.innerHTML = `<span>${meta.label}</span><span>${value}</span>`;
        list.appendChild(item);
    });
}

function renderHealth() {
    const bar = document.getElementById("healthBar");
    const valueEl = document.getElementById("healthValue");
    const ratio = state.health.current / state.health.max;
    bar.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
    valueEl.textContent = `${Math.round(state.health.current)} / ${state.health.max}`;
}

function renderBiomes() {
    const grid = document.getElementById("biomeGrid");
    grid.innerHTML = "";

    for (const biome of BIOMES) {
        const card = document.createElement("article");
        card.className = "biome-card";
        card.dataset.biomeId = biome.id;

        const img = document.createElement("img");
        img.alt = biome.name;
        img.src = resolveImagePath(biome.imageKey);
        card.appendChild(img);

        const title = document.createElement("h3");
        title.textContent = biome.name;
        card.appendChild(title);

        const status = document.createElement("span");
        status.className = `badge ${biome.unlocked ? "available" : "locked"}`;
        status.textContent = biome.id === state.currentBiome ? "Активний біом" : biome.status;
        card.appendChild(status);

        const risk = document.createElement("span");
        risk.className = "biome-status";
        risk.textContent = biome.risk;
        card.appendChild(risk);

        const description = document.createElement("p");
        description.textContent = biome.description;
        card.appendChild(description);

        const button = document.createElement("button");
        button.className = "primary";
        button.type = "button";
        if (biome.id === state.currentBiome) {
            button.textContent = "Поточна локація";
            button.disabled = true;
        } else if (biome.unlocked) {
            button.textContent = "Перейти";
            button.addEventListener("click", () => switchBiome(biome.id));
        } else {
            button.textContent = "Заглушка";
            button.disabled = true;
        }
        card.appendChild(button);

        grid.appendChild(card);
    }
}

function switchBiome(id) {
    if (state.currentBiome === id) {
        return;
    }
    state.currentBiome = id;
    if (!state.discoveredBiomes.includes(id)) {
        state.discoveredBiomes.push(id);
    }
    renderBiomes();
    renderGatherActions();
    renderCraftItems();
    const biomeMeta = BIOMES.find((biome) => biome.id === id);
    if (biomeMeta) {
        logEvent(`Перехід до біому: ${biomeMeta.name}.`, "info");
    } else {
        queueSave();
    }
}

function renderCraftItems() {
    const grid = document.getElementById("craftGrid");
    const intro = document.getElementById("craftIntro");
    grid.innerHTML = "";

    if (intro) {
        intro.textContent =
            state.currentBiome === "base"
                ? "Будівництво станцій відбувається на базі. Вироби допоможуть у подальших експедиціях."
                : "Щоб будувати станції, повернися на базу.";
        intro.classList.toggle("locked", state.currentBiome !== "base");
    }

    if (state.currentBiome !== "base") {
        const notice = document.createElement("div");
        notice.className = "locked-message";
        notice.textContent = "Будуйте станції на базі. Поверніться до табору, щоб продовжити крафт.";
        grid.appendChild(notice);
        return;
    }

    for (const item of CRAFT_ITEMS) {
        const card = document.createElement("article");
        card.className = "craft-card";
        card.dataset.craftId = item.id;

        const header = document.createElement("header");
        const img = document.createElement("img");
        img.alt = item.name;
        img.src = resolveImagePath(item.imageKey);
        header.appendChild(img);

        const titleWrapper = document.createElement("div");
        const title = document.createElement("h3");
        title.textContent = item.name;
        const subtitle = document.createElement("p");
        subtitle.textContent = item.description;
        titleWrapper.appendChild(title);
        titleWrapper.appendChild(subtitle);
        header.appendChild(titleWrapper);
        card.appendChild(header);

        const requirements = document.createElement("ul");
        requirements.className = "requirement-list";
        for (const [resource, cost] of Object.entries(item.requires)) {
            const li = document.createElement("li");
            li.textContent = `${RESOURCE_DEFS[resource].label}: ${cost}`;
            requirements.appendChild(li);
        }
        card.appendChild(requirements);

        const button = document.createElement("button");
        button.type = "button";
        button.className = "action-button";
        button.textContent = "Скрафтувати";
        button.addEventListener("click", () => craftItem(item));
        card.appendChild(button);

        grid.appendChild(card);
    }
}

function craftItem(item) {
    const canCraft = Object.entries(item.requires).every(([resource, cost]) => {
        return (state.resources[resource] ?? 0) >= cost;
    });

    if (!canCraft) {
        showCraftWarning(item.id, "Недостатньо ресурсів");
        return;
    }

    for (const [resource, cost] of Object.entries(item.requires)) {
        state.resources[resource] -= cost;
    }
    state.craftedItems[item.id] = (state.craftedItems[item.id] ?? 0) + 1;
    renderResources();
    renderInventory();
    logEvent(`Побудовано станцію: ${item.name}.`, "positive");
}

function showCraftWarning(itemId, message) {
    const card = document.querySelector(`[data-craft-id="${itemId}"]`);
    if (!card) return;

    const button = card.querySelector("button.action-button");
    const originalText = button.textContent;
    button.textContent = message;
    button.disabled = true;
    setTimeout(() => {
        button.textContent = originalText;
        button.disabled = false;
    }, 1800);
}

function renderInventory() {
    const list = document.getElementById("inventoryList");
    list.innerHTML = "";

    if (!Object.keys(state.craftedItems).length) {
        const empty = document.createElement("li");
        empty.textContent = "Станції ще не побудовано.";
        list.appendChild(empty);
        return;
    }

    for (const [itemId, amount] of Object.entries(state.craftedItems)) {
        const item = CRAFT_ITEMS.find((craft) => craft.id === itemId);
        const li = document.createElement("li");
        li.textContent = `${item ? item.name : itemId}: ${amount}`;
        list.appendChild(li);
    }
}

function formatResourceGain(resources) {
    const entries = Object.entries(resources).filter(([, amount]) => amount > 0);
    if (!entries.length) {
        return "Без трофеїв";
    }
    return entries
        .map(([resource, amount]) => {
            const label = RESOURCE_DEFS[resource]?.label ?? resource;
            return `+${Math.round(amount)} ${label}`;
        })
        .join(", ");
}

function applyRandomEvents(action, gainedResources) {
    const result = {
        events: [],
        resourcesChanged: false,
        healthChanged: false,
        energyChanged: false
    };

    switch (action.id) {
        case "forestWood": {
            if (Math.random() < 0.25) {
                const bonus = 2 + Math.floor(Math.random() * 3);
                state.resources.fiber = (state.resources.fiber ?? 0) + bonus;
                gainedResources.fiber = (gainedResources.fiber ?? 0) + bonus;
                result.resourcesChanged = true;
                result.events.push({
                    message: `Між ліан знайдено ${bonus} волокна.`,
                    type: "positive"
                });
            }

            if (Math.random() < 0.12) {
                const damage = 4 + Math.floor(Math.random() * 4);
                state.health.current = clampNumber(state.health.current - damage, 0, state.health.max);
                result.healthChanged = true;
                result.events.push({
                    message: `Гостра гілка подряпала руку (-${damage} здоров'я).`,
                    type: "danger"
                });
            }
            break;
        }
        case "forestStone": {
            if (Math.random() < 0.24) {
                const bonus = 2 + Math.floor(Math.random() * 2);
                state.resources.stone = (state.resources.stone ?? 0) + bonus;
                gainedResources.stone = (gainedResources.stone ?? 0) + bonus;
                result.resourcesChanged = true;
                result.events.push({
                    message: `Знайдено жили твердого каменю: +${bonus} каменю.`,
                    type: "positive"
                });
            }

            if (Math.random() < 0.32) {
                const damage = 5 + Math.floor(Math.random() * 5);
                state.health.current = clampNumber(state.health.current - damage, 0, state.health.max);
                result.healthChanged = true;
                result.events.push({
                    message: `Підслизнулися на мокрому камінні (-${damage} здоров'я).`,
                    type: "danger"
                });
            }
            break;
        }
        case "forestHunt": {
            if (Math.random() < 0.35) {
                const bonus = 1 + Math.floor(Math.random() * 2);
                state.resources.meat = (state.resources.meat ?? 0) + bonus;
                gainedResources.meat = (gainedResources.meat ?? 0) + bonus;
                result.resourcesChanged = true;
                result.events.push({
                    message: `Трофейна здобич: додатково ${bonus} м'яса.`,
                    type: "positive"
                });
            }

            if (Math.random() < 0.4) {
                const damage = 6 + Math.floor(Math.random() * 7);
                state.health.current = clampNumber(state.health.current - damage, 0, state.health.max);
                result.healthChanged = true;
                result.events.push({
                    message: `Сутичка з хижаком завдала ${damage} шкоди здоров'ю.`,
                    type: "danger"
                });
            }

            if (Math.random() < 0.22) {
                const extraCost = 6 + Math.floor(Math.random() * 5);
                const spent = spendEnergy(extraCost);
                if (spent > 0) {
                    result.energyChanged = true;
                    result.events.push({
                        message: `Виснажлива погоня забрала ще ${Math.round(spent)} енергії.`,
                        type: "danger"
                    });
                }
            }
            break;
        }
        default:
            break;
    }

    return result;
}

function logEvent(message, type = "info") {
    const entry = {
        message: String(message),
        type,
        timestamp: Date.now()
    };
    state.journal = [entry, ...(state.journal ?? [])].slice(0, JOURNAL_ENTRY_LIMIT);
    renderJournal();
    queueSave();
}

function renderJournal() {
    const list = document.getElementById("journalList");
    if (!list) {
        return;
    }

    list.innerHTML = "";

    if (!state.journal.length) {
        const empty = document.createElement("li");
        empty.className = "journal-entry info";
        const time = document.createElement("span");
        time.className = "journal-time";
        time.textContent = "--:--";
        const message = document.createElement("span");
        message.className = "journal-message";
        message.textContent = "Журнал поки порожній. Виконай дію, щоб побачити звіт.";
        empty.appendChild(time);
        empty.appendChild(message);
        list.appendChild(empty);
        return;
    }

    for (const entry of state.journal) {
        const li = document.createElement("li");
        li.className = `journal-entry ${entry.type ?? "info"}`;
        const time = document.createElement("span");
        time.className = "journal-time";
        time.textContent = formatJournalTime(entry.timestamp);
        const message = document.createElement("span");
        message.className = "journal-message";
        message.textContent = entry.message;
        li.append(time, message);
        list.appendChild(li);
    }
}

function formatJournalTime(timestamp) {
    if (!timestamp) {
        return "--:--";
    }

    const date = new Date(typeof timestamp === "number" ? timestamp : Date.parse(timestamp));
    if (Number.isNaN(date.getTime())) {
        return "--:--";
    }

    return date.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
}

function normalizeJournalEntry(entry) {
    if (!entry || typeof entry !== "object") {
        return null;
    }

    if (typeof entry.message !== "string") {
        return null;
    }

    const type = typeof entry.type === "string" ? entry.type : "info";
    let timestamp = Date.now();
    if (typeof entry.timestamp === "number") {
        timestamp = entry.timestamp;
    } else if (typeof entry.timestamp === "string") {
        const parsed = Date.parse(entry.timestamp);
        if (!Number.isNaN(parsed)) {
            timestamp = parsed;
        }
    }

    return { message: entry.message, type, timestamp };
}

function attachControlHandlers() {
    document.getElementById("saveGame").addEventListener("click", () => {
        saveGame();
        showTemporaryToast("Гру збережено.");
    });

    document.getElementById("resetGame").addEventListener("click", () => {
        const shouldReset = window.confirm("Скинути збереження? Цю дію неможливо відмінити.");
        if (!shouldReset) return;
        cancelAllRunningActions();
        state = createDefaultState();
        saveGame();
        renderGatherActions();
        renderCraftItems();
        renderBiomes();
        renderResources();
        renderEnergy();
        renderHealth();
        renderInventory();
        renderJournal();
        showTemporaryToast("Гру скинуто до початкового стану.");
        logEvent("База очищена: прогрес починається знову.", "info");
    });
}

function showTemporaryToast(message) {
    let toast = document.querySelector(".toast");
    if (!toast) {
        toast = document.createElement("div");
        toast.className = "toast";
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add("visible");
    setTimeout(() => {
        toast.classList.remove("visible");
    }, 2000);
}

function cancelAllRunningActions() {
    runningActions.forEach(({ frameId, timeoutId }) => {
        cancelAnimationFrame(frameId);
        clearTimeout(timeoutId);
    });
    runningActions.clear();
}

function resolveImagePath(key) {
    if (!key || !imagePaths) {
        return "https://placehold.co/600x400?text=Зображення";
    }

    const direct = imagePaths[key];
    if (typeof direct === "string") {
        return direct;
    }

    for (const group of Object.values(imagePaths)) {
        if (group && typeof group === "object" && key in group) {
            return group[key];
        }
    }

    return "https://placehold.co/600x400?text=Зображення";
}

function clampNumber(value, min, max) {
    const number = Number(value ?? min);
    if (Number.isNaN(number)) {
        return min;
    }
    return Math.max(min, Math.min(max, number));
}

init();
