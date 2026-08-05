const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function runScript(relativePath, context) {
  vm.runInNewContext(read(relativePath), context, { filename: relativePath });
}

function createClassList() {
  const values = new Set();
  return {
    add(name) {
      values.add(name);
    },
    remove(name) {
      values.delete(name);
    },
    toggle(name, force) {
      const shouldAdd = force === undefined ? !values.has(name) : Boolean(force);
      if (shouldAdd) values.add(name);
      else values.delete(name);
      return shouldAdd;
    },
    contains(name) {
      return values.has(name);
    }
  };
}

function testManifest() {
  const manifest = JSON.parse(read("manifest.json"));
  assert.strictEqual(manifest.manifest_version, 3);
  assert.strictEqual(manifest.name, "Learning Companion");
  assert.deepStrictEqual(manifest.action, { default_popup: "dist/popup.html" });
  assert.strictEqual(manifest.content_scripts.length, 1);
  assert.deepStrictEqual(manifest.content_scripts[0].js, ["dist/scripts/content.js"]);
  assert(!JSON.stringify(manifest).includes("xyz.js"));
  assert(!JSON.stringify(manifest).includes("rdr.js"));
}

async function testContentScript() {
  let listener;
  const video = {
    currentTime: 20,
    duration: 120,
    muted: false,
    paused: true,
    playbackRate: 1,
    playCalled: 0,
    pauseCalled: 0,
    play() {
      this.paused = false;
      this.playCalled += 1;
    },
    pause() {
      this.paused = true;
      this.pauseCalled += 1;
    }
  };

  const focusNode = {
    classList: createClassList(),
    closest() {
      return null;
    }
  };
  const nextNode = {
    clicked: false,
    click() {
      this.clicked = true;
    }
  };

  const context = {
    chrome: {
      runtime: {
        onMessage: {
          addListener(fn) {
            listener = fn;
          }
        }
      },
      storage: {
        sync: {
          get: async () => ({ defaultSpeed: "1.5", autoMute: true, focusDefault: false })
        }
      }
    },
    document: {
      documentElement: { classList: createClassList() },
      querySelector(selector) {
        return selector === "video" ? video : null;
      },
      querySelectorAll(selector) {
        return selector === "aside" ? [focusNode] : [];
      }
    },
    MutationObserver: class {
      constructor() {}
      observe() {}
    },
    URL,
    console
  };

  runScript("dist/scripts/content.js", context);
  assert(listener, "content script should register message listener");

  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(video.playbackRate, 1.5);
  assert.strictEqual(video.muted, true);

  let response;
  listener({ type: "SET_SPEED", speed: 3 }, null, (value) => {
    response = value;
  });
  assert.strictEqual(video.playbackRate, 3);
  assert.strictEqual(response.speed, 3);

  listener({ type: "SET_SPEED", speed: 40 }, null, (value) => {
    response = value;
  });
  assert.strictEqual(video.playbackRate, 16);
  assert.strictEqual(response.speed, 16);

  listener({ type: "JUMP", seconds: -30 }, null, (value) => {
    response = value;
  });
  assert.strictEqual(video.currentTime, 0);
  assert.strictEqual(response.currentTime, 0);

  listener({ type: "TOGGLE_PLAY" }, null, (value) => {
    response = value;
  });
  assert.strictEqual(video.paused, false);
  assert.strictEqual(response.paused, false);

  listener({ type: "TOGGLE_MUTE" }, null, (value) => {
    response = value;
  });
  assert.strictEqual(video.muted, false);
  assert.strictEqual(response.muted, false);

  listener({ type: "SKIP_TO_END" }, null, (value) => {
    response = value;
  });
  assert.strictEqual(video.currentTime, 118);
  assert.strictEqual(response.currentTime, 118);

  context.document.querySelector = (selector) => {
    if (selector === "video") return video;
    if (selector === "a[aria-label*='Next' i]") return nextNode;
    return null;
  };

  listener({ type: "GO_NEXT" }, null, (value) => {
    response = value;
  });
  assert.strictEqual(nextNode.clicked, true);
  assert.strictEqual(response.found, true);

  listener({ type: "TOGGLE_FOCUS" }, null, (value) => {
    response = value;
  });
  assert.strictEqual(response.focusMode, true);
  assert.strictEqual(context.document.documentElement.classList.contains("lc-focus-mode"), true);
  assert.strictEqual(focusNode.classList.contains("lc-hidden"), true);
}

async function testPopupScript() {
  const elements = new Map();
  const handlers = [];
  const speedButtons = ["1", "2", "4"].map((speed) => ({
    dataset: { speed },
    addEventListener(event, fn) {
      handlers.push({ event, fn, speed });
    }
  }));

  function element(id) {
    if (!elements.has(id)) {
      elements.set(id, {
        id,
        value: "",
        textContent: "",
        style: {},
        addEventListener(event, fn) {
          handlers.push({ event, fn, id });
        }
      });
    }
    return elements.get(id);
  }

  const sentMessages = [];
  const context = {
    chrome: {
      runtime: {
        openOptionsPage() {
          context.openedOptions = true;
        }
      },
      tabs: {
        async query() {
          return [{ id: 7, url: "https://www.coursera.org/learn/demo/lecture/abc" }];
        },
        async sendMessage(tabId, message) {
          sentMessages.push({ tabId, message });
          return { found: true, paused: false, speed: message.speed || 1 };
        }
      }
    },
    document: {
      getElementById: element,
      querySelectorAll(selector) {
        return selector === ".speed-btn" ? speedButtons : [];
      }
    },
    URL,
    console
  };

  runScript("dist/scripts/popup.js", context);
  await new Promise((resolve) => setImmediate(resolve));
  assert(handlers.some((handler) => handler.id === "endBtn"));
  assert(handlers.some((handler) => handler.id === "nextBtn"));
  assert(!handlers.some((handler) => handler.id === "saveNotesBtn"));
  assert(sentMessages.some((entry) => entry.message.type === "GET_STATUS"));
}

async function testSettingsScript() {
  const elements = new Map();
  const handlers = [];
  const saved = {};

  function element(id) {
    if (!elements.has(id)) {
      elements.set(id, {
        id,
        checked: false,
        textContent: "",
        value: "",
        addEventListener(event, fn) {
          handlers.push({ event, fn, id });
        }
      });
    }
    return elements.get(id);
  }

  const context = {
    chrome: {
      storage: {
        sync: {
          async get() {
            return { defaultSpeed: "2", autoMute: true, focusDefault: true };
          },
          async set(value) {
            Object.assign(saved, value);
          }
        }
      }
    },
    document: { getElementById: element },
    setTimeout(fn) {
      fn();
    },
    console
  };

  runScript("dist/scripts/settings.js", context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(element("defaultSpeed").value, "2");
  assert.strictEqual(element("autoMute").checked, true);
  assert.strictEqual(element("focusDefault").checked, true);

  const saveHandler = handlers.find((handler) => handler.id === "saveBtn");
  assert(saveHandler, "settings save button should register a click handler");
  await saveHandler.fn();
  assert.deepStrictEqual(saved, {
    defaultSpeed: "2",
    autoMute: true,
    focusDefault: true
  });
}

async function testBackgroundScript() {
  let commandListener;
  const sent = [];
  const context = {
    chrome: {
      commands: {
        onCommand: {
          addListener(fn) {
            commandListener = fn;
          }
        }
      },
      tabs: {
        async query() {
          return [{ id: 11 }];
        },
        sendMessage(tabId, message) {
          sent.push({ tabId, message });
        }
      }
    }
  };

  runScript("dist/scripts/background.js", context);
  await commandListener("toggle_focus");
  await commandListener("speed_up");
  assert.strictEqual(JSON.stringify(sent), JSON.stringify([
    { tabId: 11, message: { type: "TOGGLE_FOCUS" } },
    { tabId: 11, message: { type: "SPEED_STEP", delta: 0.25 } }
  ]));
}

(async () => {
  testManifest();
  await testContentScript();
  await testPopupScript();
  await testSettingsScript();
  await testBackgroundScript();
  console.log("extension smoke tests passed");
})();
