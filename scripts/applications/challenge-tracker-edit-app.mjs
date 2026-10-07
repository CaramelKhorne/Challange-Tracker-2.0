import { MODULE, TEMPLATES } from "../main/constants.mjs";
import { ChallengeTrackerFlag } from "../main/flags.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class challengeTrackerEditApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(ownerId, challengeTrackerId) {
    super();
    this.ownerId = ownerId || game.userId;
    this.challengeTrackerId = challengeTrackerId;
    this.newChallengeTrackerId = `${MODULE.ID}-${Math.random().toString(16).slice(2)}`;
  }

  /* -------------------------------------------- */

  static DEFAULT_OPTIONS = {
    classes: ["challenge-tracker-edit-app"],
    form: {
      handler: challengeTrackerEditApp.submit,
      closeOnSubmit: true
    },
    id: "challenge-tracker-edit-app",
    position: {
      height: 600,
      width: 400
    },
    tag: "form",
    window: {
      minimizable: true,
      resizable: true,
      title: "challengeTracker.labels.editForm.title"
    }
  };

  /* -------------------------------------------- */

  static PARTS = {
    form: {
      template: TEMPLATES.challengeTrackerEditApp
    }
  };

  /* -------------------------------------------- */

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const ColorPickerField = game.colorPicker?.ColorPickerField;
    if ( !ColorPickerField ) {
      const message = "Challenge Tracker: Update and enable the Color Picker module before opening the editor.";
      ui.notifications.error(message);
      throw new Error(message);
    }
    const colorPickerField = new ColorPickerField();

    if ( this.challengeTrackerId ) {
      const flags = ChallengeTrackerFlag.get(this.ownerId, this.challengeTrackerId);
      if ( !flags ) {
        const message = game.i18n.format("challengeTracker.errors.doesNotExist", { value: this.challengeTrackerId });
        ui.notifications.error(message);
        throw new Error(message);
      }
      return { ...context, ...flags, ownerId: this.ownerId, id: this.challengeTrackerId, colorPickerField };
    } else {
      return {
        ...context,
        colorPickerField,
        backgroundImage: null,
        frameColor: null,
        frameWidth: "medium",
        id: this.newChallengeTrackerId,
        foregroundImage: null,
        innerBackgroundColor: null,
        innerColor: null,
        innerCurrent: 0,
        innerTotal: 3,
        outerBackgroundColor: null,
        outerColor: null,
        outerCurrent: 0,
        outerTotal: 4,
        ownerId: this.ownerId,
        persist: true,
        show: false,
        size: null,
        title: game.i18n.localize("challengeTracker.labels.title"),
        windowed: true
      };
    }
  }

  /* -------------------------------------------- */

  /* Initialise the challengeTrackerEditApp */
  static init() {
    this.challengeTrackerEditApp = new challengeTrackerEditApp();
  }

  /* -------------------------------------------- */

  /**
   * Open the Edit Challenge Tracker form
   * @param {string} ownerId User that owns the flag
   * @param {string} [challengeTrackerId=null] Unique identifier for the Challenge Tracker
   * @returns {Promise<challengeTrackerEditApp>} Rendered editor
   **/
  static async open(ownerId, challengeTrackerId = null) {
    const editForm = challengeTrackerEditApp.challengeTrackerEditApp;
    editForm.ownerId = ownerId ?? game.userId;
    editForm.challengeTrackerId = challengeTrackerId;
    editForm.newChallengeTrackerId = `${MODULE.ID}-${Math.random().toString(16).slice(2)}`;
    return editForm.render({ force: true });
  }

  /* -------------------------------------------- */

  /**
   * Merge options with flag and, if open, redraw the Challenge Tracker
   * @param {SubmitEvent|Event} _event Originating form submission event
   * @param {HTMLFormElement} form Submitted form
   * @param {FormDataExtended} formData Processed form values
   **/
  static async submit(_event, form, formData) {
    const dataElement = form.querySelector("[data-owner-id][data-challenge-tracker-id]");
    if ( !dataElement?.dataset.ownerId || !dataElement.dataset.challengeTrackerId ) {
      throw new Error("Challenge Tracker: The submitted form is missing tracker metadata.");
    }
    const { ownerId, challengeTrackerId } = dataElement.dataset;
    const user = game.users.get(ownerId);
    if ( !user ) throw new Error(`Challenge Tracker: User '${ownerId}' does not exist.`);
    const submittedData = formData.object;
    const flag = ChallengeTrackerFlag.get(ownerId, challengeTrackerId);
    let challengeTrackerOptions;
    if ( flag ) {
      challengeTrackerOptions = foundry.utils.mergeObject(flag, submittedData, { inplace: false });
    } else {
      const title = submittedData.title ?? game.i18n.localize("challengeTracker.labels.title");
      const persist = true;
      const id = challengeTrackerId;
      const listPosition = Object.keys(user.flags[MODULE.ID] || {}).length + 1;
      challengeTrackerOptions = { ...submittedData, ownerId, id, listPosition, persist, title };
    }
    const savedOptions = await ChallengeTrackerFlag.set(ownerId, challengeTrackerOptions);
    const challengeTracker = Object.values(game.challengeTracker ?? {})
      .find(ct => ct.challengeTrackerOptions.id === challengeTrackerId
        && ct.challengeTrackerOptions.ownerId === ownerId);
    if ( challengeTracker ) await challengeTracker.draw(savedOptions);
  }
}
