// Popup script for Fake Form Filler extension
class PopupController {
  constructor() {
    this.elements = {
      fillBtn: document.getElementById("fillBtn"),
      clearBtn: document.getElementById("clearBtn"),
      scanBtn: document.getElementById("scanBtn"),
      statusIndicator: document.getElementById("statusIndicator"),
      statusText: document.getElementById("statusText"),
      formsCount: document.getElementById("formsCount"),
      fieldsCount: document.getElementById("fieldsCount"),
      progressBar: document.getElementById("progressBar"),
      progressFill: document.getElementById("progressFill"),
      autoFillEnabled: document.getElementById("autoFillEnabled"),
      visualFeedbackEnabled: document.getElementById("visualFeedbackEnabled"),
      skipHiddenFields: document.getElementById("skipHiddenFields"),
    };

    this.currentTab = null;
    this.formData = null;

    this.init();
  }

  async init() {
    await this.getCurrentTab();
    await this.loadSettings();
    this.bindEvents();
    await this.scanForForms();
  }

  async getCurrentTab() {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      this.currentTab = tab;
    } catch (error) {
      console.error("Error getting current tab:", error);
      this.showStatus("Error: Unable to access current tab", "error");
    }
  }

  async loadSettings() {
    try {
      const settings = await chrome.storage.sync.get({
        autoFillEnabled: true,
        visualFeedbackEnabled: true,
        skipHiddenFields: true,
      });

      this.elements.autoFillEnabled.checked = settings.autoFillEnabled;
      this.elements.visualFeedbackEnabled.checked =
        settings.visualFeedbackEnabled;
      this.elements.skipHiddenFields.checked = settings.skipHiddenFields;
    } catch (error) {
      console.error("Error loading settings:", error);
    }
  }

  async saveSettings() {
    try {
      const settings = {
        autoFillEnabled: this.elements.autoFillEnabled.checked,
        visualFeedbackEnabled: this.elements.visualFeedbackEnabled.checked,
        skipHiddenFields: this.elements.skipHiddenFields.checked,
      };

      await chrome.storage.sync.set(settings);
    } catch (error) {
      console.error("Error saving settings:", error);
    }
  }

  bindEvents() {
    // Button events
    this.elements.fillBtn.addEventListener("click", () => this.fillForms());
    this.elements.clearBtn.addEventListener("click", () => this.clearForms());
    this.elements.scanBtn.addEventListener("click", () => this.scanForForms());

    // Settings events
    this.elements.autoFillEnabled.addEventListener("change", () =>
      this.saveSettings()
    );
    this.elements.visualFeedbackEnabled.addEventListener("change", () =>
      this.saveSettings()
    );
    this.elements.skipHiddenFields.addEventListener("change", () =>
      this.saveSettings()
    );

    // Listen for messages from content script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
    });
  }

  async scanForForms() {
    if (!this.currentTab) {
      this.showStatus("No active tab found", "error");
      return;
    }

    try {
      this.showStatus("Scanning for forms...", "loading");
      this.setButtonState("scanning");

      // Ensure content script is injected first
      await chrome.runtime.sendMessage({
        type: "INJECT_CONTENT_SCRIPT",
        tabId: this.currentTab.id,
      });

      // Scan for forms
      const results = await chrome.scripting.executeScript({
        target: { tabId: this.currentTab.id },
        func: () => {
          if (window.fakeFormFiller) {
            return window.fakeFormFiller.scanForms();
          }
          return { forms: 0, fields: 0, error: "Content script not loaded" };
        },
      });

      if (results && results[0] && results[0].result) {
        const scanResult = results[0].result;

        if (scanResult.error) {
          throw new Error(scanResult.error);
        }

        this.formData = scanResult;
        this.updateFormInfo(scanResult.forms, scanResult.fields);

        if (scanResult.forms > 0) {
          this.showStatus("Forms detected successfully", "success");
          this.setButtonState("ready");
        } else {
          this.showStatus("No forms found on this page", "warning");
          this.setButtonState("no-forms");
        }
      } else {
        throw new Error("Failed to scan for forms");
      }
    } catch (error) {
      console.error("Error scanning forms:", error);
      this.showStatus("Failed to scan forms", "error");
      this.setButtonState("error");
    }
  }

  async fillForms() {
    if (!this.currentTab || !this.formData) {
      await this.scanForForms();
      if (!this.formData) return;
    }

    try {
      this.showStatus("Filling forms...", "loading");
      this.setButtonState("filling");
      this.showProgress(0);

      // Ensure content script is injected
      await chrome.runtime.sendMessage({
        type: "INJECT_CONTENT_SCRIPT",
        tabId: this.currentTab.id,
      });

      const settings = {
        visualFeedback: this.elements.visualFeedbackEnabled.checked,
        skipHidden: this.elements.skipHiddenFields.checked,
      };

      const results = await chrome.scripting.executeScript({
        target: { tabId: this.currentTab.id },
        func: options => {
          if (window.fakeFormFiller) {
            return window.fakeFormFiller.fillForms(options);
          }
          return { success: false, error: "Content script not loaded" };
        },
        args: [settings],
      });

      if (results && results[0] && results[0].result) {
        const fillResult = results[0].result;

        if (fillResult.success) {
          this.showProgress(100);
          this.showStatus(
            `Filled ${fillResult.fieldsProcessed} fields`,
            "success"
          );
          this.setButtonState("ready");

          setTimeout(() => {
            this.hideProgress();
          }, 2000);
        } else {
          throw new Error(fillResult.error || "Failed to fill forms");
        }
      } else {
        throw new Error("No response from content script");
      }
    } catch (error) {
      console.error("Error filling forms:", error);
      this.showStatus("Failed to fill forms", "error");
      this.setButtonState("ready");
      this.hideProgress();
    }
  }

  async clearForms() {
    if (!this.currentTab) {
      this.showStatus("No active tab found", "error");
      return;
    }

    try {
      this.showStatus("Clearing forms...", "loading");
      this.setButtonState("clearing");

      // Ensure content script is injected
      await chrome.runtime.sendMessage({
        type: "INJECT_CONTENT_SCRIPT",
        tabId: this.currentTab.id,
      });

      const results = await chrome.scripting.executeScript({
        target: { tabId: this.currentTab.id },
        func: () => {
          if (window.fakeFormFiller) {
            return window.fakeFormFiller.clearForms();
          }
          return { success: false, error: "Content script not loaded" };
        },
      });

      if (results && results[0] && results[0].result) {
        const clearResult = results[0].result;

        if (clearResult.success) {
          this.showStatus(
            `Cleared ${clearResult.fieldsCleared} fields`,
            "success"
          );
          this.setButtonState("ready");
        } else {
          throw new Error(clearResult.error || "Failed to clear forms");
        }
      } else {
        throw new Error("No response from content script");
      }
    } catch (error) {
      console.error("Error clearing forms:", error);
      this.showStatus("Failed to clear forms", "error");
      this.setButtonState("ready");
    }
  }

  handleMessage(message, sender, sendResponse) {
    switch (message.type) {
      case "FORM_SCAN_UPDATE":
        this.updateFormInfo(message.forms, message.fields);
        break;

      case "FILL_PROGRESS":
        this.showProgress(message.progress);
        break;

      case "FILL_COMPLETE":
        this.showStatus(`Filled ${message.fieldsProcessed} fields`, "success");
        this.setButtonState("ready");
        this.hideProgress();
        break;

      case "FILL_ERROR":
        this.showStatus("Error filling forms", "error");
        this.setButtonState("ready");
        this.hideProgress();
        break;

      case "CLEAR_COMPLETE":
        this.showStatus(`Cleared ${message.fieldsCleared} fields`, "success");
        this.setButtonState("ready");
        break;
    }
  }

  showStatus(message, type = "ready") {
    const statusIndicator = this.elements.statusIndicator;
    const statusText = this.elements.statusText;

    statusText.textContent = message;

    // Update status indicator
    statusIndicator.className = "status-indicator";
    if (type === "warning") {
      statusIndicator.classList.add("warning");
    } else if (type === "error") {
      statusIndicator.classList.add("error");
    }

    // Auto-clear status after 3 seconds
    setTimeout(() => {
      if (statusText.textContent === message) {
        this.showStatus("Ready", "ready");
      }
    }, 3000);
  }

  showToast(message, type = "info") {
    // Create toast element
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <div class="toast-content">
        <span class="toast-message">${message}</span>
        <button class="toast-close">&times;</button>
      </div>
    `;

    // Add toast to container
    document.body.appendChild(toast);

    // Show toast
    setTimeout(() => toast.classList.add("show"), 100);

    // Auto-hide after 3 seconds
    setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => toast.remove(), 300);
    }, 3000);

    // Close button functionality
    toast.querySelector(".toast-close").addEventListener("click", () => {
      toast.classList.remove("show");
      setTimeout(() => toast.remove(), 300);
    });
  }

  setButtonState(state) {
    const { fillBtn, clearBtn, scanBtn } = this.elements;

    // Reset all button states
    [fillBtn, clearBtn, scanBtn].forEach(btn => {
      btn.classList.remove("loading");
      btn.disabled = false;
    });

    switch (state) {
      case "scanning":
        scanBtn.classList.add("loading");
        scanBtn.disabled = true;
        fillBtn.disabled = true;
        clearBtn.disabled = true;
        break;

      case "filling":
        fillBtn.classList.add("loading");
        fillBtn.disabled = true;
        clearBtn.disabled = true;
        scanBtn.disabled = true;
        break;

      case "clearing":
        clearBtn.classList.add("loading");
        clearBtn.disabled = true;
        fillBtn.disabled = true;
        scanBtn.disabled = true;
        break;

      case "ready":
        fillBtn.disabled = false;
        clearBtn.disabled = false;
        break;

      case "no-forms":
        fillBtn.disabled = true;
        clearBtn.disabled = true;
        break;

      case "error":
        fillBtn.disabled = true;
        clearBtn.disabled = true;
        break;
    }
  }

  updateFormInfo(forms, fields) {
    this.elements.formsCount.textContent = forms;
    this.elements.fieldsCount.textContent = fields;
  }

  showProgress(percentage) {
    this.elements.progressBar.classList.add("active");
    this.elements.progressFill.style.width = `${percentage}%`;
  }

  hideProgress() {
    this.elements.progressBar.classList.remove("active");
    setTimeout(() => {
      this.elements.progressFill.style.width = "0%";
    }, 300);
  }
}

// Initialize popup when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  new PopupController();
});
