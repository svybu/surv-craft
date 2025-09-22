const STORAGE_KEY = "survCraftIdleSaveV1";
const AUTO_SAVE_INTERVAL = 30000;

const RESOURCE_DEFS = {
    wood: { label: "Деревина", iconKey: "woodResource" },
    stone: { label: "Камінь", iconKey: "stoneResource" },
    fiber: { label: "Волокно", iconKey: "fiberResource" }
};

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
        id: "gatherWood",
        name: "Збір деревини",
        description: "Збирай сухі гілки та колоди поруч із табором.",
        resource: "wood",
        amount: 6,
        duration: 4500,
        energyCost: 24,
        biome: "safe",
        imageKey: "gatherWood"
    },
    {
        id: "gatherStone",
        name: "Пошук каменю",
        description: "Повільно збирай валуни та уламки порід на галявині.",
        resource: "stone",
        amount: 4,
        duration: 5200,
        energyCost: 28,
        biome: "safe",
        imageKey: "gatherStone"
    },
    {
        id: "gatherFiber",
        name: "Заготівля волокон",
        description: "Збирай рослинні волокна з кущів поблизу табору.",
        resource: "fiber",
        amount: 5,
        duration: 3800,
        energyCost: 18,
        biome: "safe",
        imageKey: "gatherFiber"
    }
];

const CRAFT_ITEMS = [
    {
        id: "woodenClub",
        name: "Дерев'яна палиця",
        description: "Легка зброя та багатофункціональний інструмент.",
        requires: { wood: 12, fiber: 4 },
        imageKey: "woodenClub"
    },
    {
        id: "stoneHatchet",
        name: "Кам'яна сокира",
        description: "Дозволяє ефективніше рубати дерева у майбутніх оновленнях.",
        requires: { wood: 8, stone: 6, fiber: 4 },
        imageKey: "stoneHatchet"
    },
    {
        id: "fiberSling",
        name: "Волоконна праща",
        description: "Простий дальній інструмент для захисту табору.",
        requires: { fiber: 12, stone: 3 },
        imageKey: "fiberSling"
    }
];

const BIOMES = [
    {
        id: "safe",
        name: "Затишна долина",
        description: "Безпечна зона для відновлення сил та базового збирання ресурсів.",
        status: "Доступний",
        risk: "Ризик: низький",
        imageKey: "biomeSafe",
        unlocked: true
    },
    {
        id: "mistForest",
        name: "Туманний ліс",
        description: "Заглушка: небезпечні хащі, де можна віднайти рідкісні рослини.",
        status: "Незабаром",
        risk: "Ризик: середній",
        imageKey: "biomeForest",
        unlocked: false
    },
    {
        id: "basaltCliffs",
        name: "Базальтові урвища",
        description: "Заглушка: круті скелі з багатими покладами мінералів.",
        status: "Незабаром",
        risk: "Ризик: високий",
        imageKey: "biomeCliffs",
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
            fiber: 0
        },
        craftedItems: {},
        currentBiome: "safe",
        discoveredBiomes: ["safe"]
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

    for (const action of GATHER_ACTIONS) {
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
    label.textContent = `+${action.amount} ${RESOURCE_DEFS[action.resource].label}`;
    label.classList.remove("warning");

    state.resources[action.resource] = (state.resources[action.resource] ?? 0) + action.amount;
    renderResources();
    button.disabled = false;

    queueSave();

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
    return Object.values(state.energy).reduce((sum, value) => sum + value, 0);
}

function spendEnergy(amount) {
    let remaining = amount;
    const order = ["fast", "medium", "slow"];
    for (const segment of order) {
        if (remaining <= 0) {
            break;
        }
        const available = state.energy[segment];
        const used = Math.min(available, remaining);
        state.energy[segment] -= used;
        remaining -= used;
    }
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
    for (const [segment, config] of Object.entries(ENERGY_SEGMENTS)) {
        const container = document.querySelector(`.energy-segment[data-segment="${segment}"]`);
        if (!container) continue;
        const fill = container.querySelector(".segment-fill");
        const valueEl = container.querySelector(".segment-value");
        const value = Math.round(state.energy[segment]);
        const percentage = Math.max(0, Math.min(100, (value / config.max) * 100));
        fill.style.width = `${percentage}%`;
        valueEl.textContent = `${value} / ${config.max}`;
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
    state.currentBiome = id;
    if (!state.discoveredBiomes.includes(id)) {
        state.discoveredBiomes.push(id);
    }
    renderBiomes();
    renderGatherActions();
    queueSave();
}

function renderCraftItems() {
    const grid = document.getElementById("craftGrid");
    grid.innerHTML = "";

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
    queueSave();
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
        empty.textContent = "Інструменти ще не створено.";
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
        showTemporaryToast("Гру скинуто до початкового стану.");
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
