import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { beforeEach, test } from "node:test";

// Exercise the real editor and flag code with the documented ApplicationV2 contract.
// These stubs do not replace an in-world Foundry rendering test.
class ApplicationV2 {
  async _prepareContext() {
    return { baseContext: true };
  }

  async render(options) {
    this.renderOptions = options;
    this.context = await this._prepareContext(options);
    return this;
  }
}

/**
 * Model the plain-object merge used by the flag and editor code.
 * @param {object} original
 * @param {object} updates
 * @param {object} options
 * @param {boolean} options.inplace
 * @returns {object}
 */
function mergeObject(original, updates, { inplace = true } = {}) {
  assert.equal(Object.getPrototypeOf(original), Object.prototype);
  assert.equal(Object.getPrototypeOf(updates), Object.prototype);
  const merged = inplace ? original : structuredClone(original);
  for (const [key, value] of Object.entries(updates)) {
    if ( value && Object.getPrototypeOf(value) === Object.prototype ) {
      merged[key] = mergeObject(merged[key] ?? {}, value);
    } else merged[key] = value;
  }
  return merged;
}

globalThis.foundry = {
  applications: { api: { ApplicationV2, HandlebarsApplicationMixin: Base => Base } },
  utils: { mergeObject }
};

const { challengeTrackerEditApp: Editor } = await import("../scripts/applications/challenge-tracker-edit-app.mjs");
let writes;
let notifications;
let listRefreshes;

/**
 * Create an in-memory User document for flag persistence checks.
 * @param {string} id
 * @param {object} flags
 * @returns {object}
 */
function makeUser(id, flags = {}) {
  return {
    id,
    flags,
    getFlag(scope, key) {
      return this.flags[scope]?.[key];
    },
    async setFlag(scope, key, options) {
      const saved = structuredClone(options);
      writes.push({ ownerId: id, key, options: saved });
      this.flags[scope] ??= {};
      this.flags[scope][key] = saved;
      return this;
    }
  };
}

/**
 * Supply the tracker metadata from a submitted form.
 * @param {string} ownerId
 * @param {string} challengeTrackerId
 * @returns {object}
 */
function makeForm(ownerId, challengeTrackerId) {
  return {
    querySelector() {
      return { dataset: { ownerId, challengeTrackerId } };
    }
  };
}

class FormDataExtended {
  constructor(object) {
    this.object = object;
    this.fields = {};
  }
}

beforeEach(() => {
  writes = [];
  notifications = [];
  listRefreshes = 0;
  globalThis.game = {
    userId: "owner",
    users: new Map([["owner", makeUser("owner")]]),
    colorPicker: { ColorPickerField: class {} },
    i18n: {
      localize: key => key,
      format: (key, data) => `${key}: ${data.value}`
    },
    challengeTracker: {},
    challengeTrackerListApp: { render: () => listRefreshes++ }
  };
  globalThis.ui = { notifications: { error: message => notifications.push(message) } };
  delete globalThis.ColorPicker;
  Editor.init();
});

test("open uses ApplicationV2 render options and numeric default dimensions", async () => {
  const editor = await Editor.open("owner");
  assert.deepEqual(editor.renderOptions, { force: true });
  assert.equal(Editor.DEFAULT_OPTIONS.position.width, 400);
  assert.equal(Editor.DEFAULT_OPTIONS.position.height, 600);
  assert.equal(editor.context.ownerId, "owner");
  assert.equal(editor.context.baseContext, true);
  assert.equal(Object.hasOwn(Editor.prototype, "_onRender"), false);
});

test("new tracker retains its ID on re-render and gets another ID on next open", async () => {
  const editor = await Editor.open("owner");
  const firstId = editor.context.id;
  await editor.render({});
  assert.equal(editor.context.id, firstId);
  await Editor.open("owner");
  assert.notEqual(editor.context.id, firstId);
});

test("create saves processed fields with a null event currentTarget and refreshes the list", async () => {
  const data = {
    title: "Escape the ruins", outerTotal: 6, outerCurrent: 2,
    innerTotal: 3, innerCurrent: 1, windowed: true, show: false,
    scroll: false, frameColor: "#112233", outerColor: "#11223388",
    backgroundImage: "worlds/test/clock.webp", size: 280
  };
  await Editor.submit({ currentTarget: null }, makeForm("owner", "new-clock"), new FormDataExtended(data));
  assert.deepEqual(writes[0], {
    ownerId: "owner", key: "new-clock",
    options: { ...data, ownerId: "owner", id: "new-clock", listPosition: 1, persist: true }
  });
  assert.equal(listRefreshes, 1);
  assert.equal(Object.hasOwn(writes[0].options, "object"), false);
  assert.equal(Object.hasOwn(writes[0].options, "fields"), false);
});

test("create appends to an existing list and supplies a default title", async () => {
  game.users.get("owner").flags["challenge-tracker"] = { a: { id: "a" }, b: { id: "b" } };
  const form = makeForm("owner", "c");
  await Editor.submit({ currentTarget: form }, form, new FormDataExtended({ outerTotal: 8 }));
  assert.equal(writes[0].options.listPosition, 3);
  assert.equal(writes[0].options.title, "challengeTracker.labels.title");
});

test("edit preserves hidden options and does not mutate the cached flag before saving", async () => {
  const existing = {
    id: "old-clock", ownerId: "owner", title: "Old", listPosition: 2,
    persist: true, position: { left: 100, top: 50 }, closeFunction: "customCallback",
    outerTotal: 4, outerCurrent: 1, scroll: true
  };
  game.users.get("owner").flags["challenge-tracker"] = { "old-clock": existing };
  const redraws = [];
  game.challengeTracker["old-clock"] = {
    challengeTrackerOptions: existing,
    draw: async options => redraws.push(options)
  };
  const form = makeForm("owner", "old-clock");
  await Editor.submit({ currentTarget: form }, form, new FormDataExtended({
    title: "New", outerTotal: 8, outerCurrent: 0, scroll: false
  }));
  assert.equal(existing.title, "Old");
  assert.deepEqual(writes[0].options, {
    ...existing, title: "New", outerTotal: 8, outerCurrent: 0, scroll: false
  });
  assert.deepEqual(redraws, [writes[0].options]);
});

test("editor reopens a saved tracker and restores authoritative metadata", async () => {
  await Editor.submit(null, makeForm("owner", "saved-clock"), new FormDataExtended({ title: "Saved", outerTotal: 6 }));
  delete game.users.get("owner").flags["challenge-tracker"]["saved-clock"].ownerId;
  const editor = await Editor.open("owner", "saved-clock");
  assert.equal(editor.context.id, "saved-clock");
  assert.equal(editor.context.ownerId, "owner");
  assert.equal(editor.context.title, "Saved");
  assert.equal(editor.context.outerTotal, 6);
});

test("create works before any tracker window is registered", async () => {
  delete game.challengeTracker;
  await Editor.submit(null, makeForm("owner", "new-clock"), new FormDataExtended({ title: "New" }));
  assert.equal(writes.length, 1);
});

test("missing Color Picker reports the dependency error", async () => {
  delete game.colorPicker;
  await assert.rejects(Editor.open("owner"), /Color Picker/);
  assert.equal(notifications.length, 1);
});

test("missing existing tracker is reported instead of opening a blank editor", async () => {
  await assert.rejects(Editor.open("owner", "missing"), /doesNotExist/);
  assert.equal(notifications.length, 1);
});

test("invalid form metadata or owner cannot write a flag", async () => {
  await assert.rejects(Editor.submit(null, { querySelector: () => null }, new FormDataExtended({})), /metadata/);
  await assert.rejects(Editor.submit(null, makeForm("missing", "clock"), new FormDataExtended({})), /User/);
  assert.equal(writes.length, 0);
});

test("template preserves tracker metadata without duplicating the application ID", async () => {
  const template = await readFile(new URL("../templates/challenge-tracker-edit-app.hbs", import.meta.url), "utf8");
  assert.doesNotMatch(template, /id="challenge-tracker-edit-app"/);
  assert.match(template, /data-owner-id="\{\{ownerId\}\}"/);
  assert.match(template, /data-challenge-tracker-id="\{\{id\}\}"/);
});
