// Background service worker for Fake Form Filler extension

class BackgroundService {
  constructor() {
    this.init();
  }

  init() {
    // Listen for extension installation/startup
    chrome.runtime.onStartup.addListener(() => this.handleStartup());
    chrome.runtime.onInstalled.addListener(details =>
      this.handleInstalled(details)
    );

    // Listen for tab updates to inject content scripts
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) =>
      this.handleTabUpdated(tabId, changeInfo, tab)
    );

    // Listen for messages from content scripts and popup
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
      return true; // Keep the message channel open for async responses
    });

    // Handle action click (extension icon)
    chrome.action.onClicked.addListener(tab => this.handleActionClick(tab));

    // Listen for keyboard shortcuts
    chrome.commands.onCommand.addListener(command =>
      this.handleCommand(command)
    );

    // Context menu setup
    this.setupContextMenus();
  }

  handleStartup() {
    console.log("Fake Form Filler extension started");
    this.initializeExtension();
  }

  handleInstalled(details) {
    console.log("Fake Form Filler extension installed:", details.reason);

    if (details.reason === "install") {
      this.handleFirstInstall();
    } else if (details.reason === "update") {
      this.handleUpdate(details.previousVersion);
    }
  }

  async handleFirstInstall() {
    // Set default settings
    const defaultSettings = {
      autoFillEnabled: true,
      visualFeedbackEnabled: true,
      skipHiddenFields: true,
      fillDelay: 100,
      dataLocale: "en",
      enabledFieldTypes: {
        text: true,
        email: true,
        password: true,
        textarea: true,
        select: true,
        checkbox: true,
        radio: true,
        date: true,
        number: true,
        url: true,
        tel: true,
      },
    };

    try {
      await chrome.storage.sync.set(defaultSettings);
      console.log("Default settings saved");
    } catch (error) {
      console.error("Error saving default settings:", error);
    }

    // Open welcome page (optional)
    // chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
  }

  async handleUpdate(previousVersion) {
    console.log(
      `Extension updated from ${previousVersion} to ${
        chrome.runtime.getManifest().version
      }`
    );

    // Handle migration logic if needed
    try {
      const settings = await chrome.storage.sync.get();

      // Add any new default settings that might not exist
      const updates = {};

      if (settings.fillDelay === undefined) {
        updates.fillDelay = 100;
      }

      if (settings.dataLocale === undefined) {
        updates.dataLocale = "en";
      }

      if (Object.keys(updates).length > 0) {
        await chrome.storage.sync.set(updates);
        console.log("Settings updated after version upgrade");
      }
    } catch (error) {
      console.error("Error updating settings after upgrade:", error);
    }
  }

  async handleTabUpdated(tabId, changeInfo, tab) {
    // Only process when page is completely loaded
    if (changeInfo.status !== "complete" || !tab.url) {
      return;
    }

    // Skip chrome:// and extension pages
    if (
      tab.url.startsWith("chrome://") ||
      tab.url.startsWith("chrome-extension://")
    ) {
      return;
    }

    try {
      // Check if auto-fill is enabled
      const settings = await chrome.storage.sync.get(["autoFillEnabled"]);

      if (settings.autoFillEnabled) {
        // Small delay to ensure DOM is ready
        setTimeout(async () => {
          try {
            await this.injectContentScript(tabId);
          } catch (error) {
            console.error("Error injecting content script:", error);
          }
        }, 500);
      }
    } catch (error) {
      console.error("Error checking auto-fill settings:", error);
    }
  }

  async injectContentScript(tabId) {
    try {
      // Check if content script is already injected
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => window.fakeFormFiller !== undefined,
      });

      const isInjected = results && results[0] && results[0].result;

      if (!isInjected) {
        // Try injecting via files (MV3) - inject both together
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ["libs/faker.bundle.js", "content/content.js"],
          });
          console.log("Content script injected successfully via files.");
        } catch (scriptingError) {
          console.warn(
            "Programmatic injection failed, attempting DOM injection:",
            scriptingError
          );
          // Fallback to DOM injection if programmatic fails (e.g., due to CSP)
          await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
              return new Promise(resolve => {
                const scriptFaker = document.createElement("script");
                scriptFaker.src = chrome.runtime.getURL("libs/faker.bundle.js");
                scriptFaker.onload = () => {
                  const scriptContent = document.createElement("script");
                  scriptContent.src =
                    chrome.runtime.getURL("content/content.js");
                  scriptContent.onload = () => resolve(true);
                  scriptContent.onerror = () => resolve(false);
                  document.documentElement.appendChild(scriptContent);
                };
                scriptFaker.onerror = () => resolve(false);
                document.documentElement.appendChild(scriptFaker);
              });
            },
          });
          console.log("Content script injected successfully via DOM.");
        }

        console.log("Content script injected successfully");
      }
    } catch (error) {
      console.error("Error injecting content script:", error);
    }
  }

  async handleMessage(message, sender, sendResponse) {
    try {
      switch (message.type) {
        case "GET_SETTINGS":
          const settings = await chrome.storage.sync.get();
          sendResponse({ success: true, settings });
          break;

        case "SAVE_SETTINGS":
          await chrome.storage.sync.set(message.settings);
          sendResponse({ success: true });
          break;

        case "INJECT_CONTENT_SCRIPT":
          // Content scripts are now auto-injected via manifest
          sendResponse({ success: true });
          break;

        case "LOG_ERROR":
          console.error("Content script error:", message.error);
          sendResponse({ success: true });
          break;

        case "GET_TAB_INFO":
          if (sender.tab) {
            sendResponse({
              success: true,
              tabInfo: {
                id: sender.tab.id,
                url: sender.tab.url,
                title: sender.tab.title,
              },
            });
          } else {
            sendResponse({ success: false, error: "No tab information" });
          }
          break;

        default:
          sendResponse({ success: false, error: "Unknown message type" });
      }
    } catch (error) {
      console.error("Error handling message:", error);
      sendResponse({ success: false, error: error.message });
    }
  }

  handleActionClick(tab) {
    // This will open the popup automatically, but we can also handle programmatic actions here
    console.log("Extension icon clicked on tab:", tab.id);
  }

  async handleCommand(command) {
    try {
      switch (command) {
        case "fill-forms":
          // Get the active tab and fill forms
          const [tab] = await chrome.tabs.query({
            active: true,
            currentWindow: true,
          });
          if (
            tab &&
            tab.url &&
            !tab.url.startsWith("chrome://") &&
            !tab.url.startsWith("chrome-extension://")
          ) {
            await this.fillCurrentForm(tab.id);
            console.log("Forms filled via keyboard shortcut");
          }
          break;
        default:
          console.log("Unknown command:", command);
      }
    } catch (error) {
      console.error("Error handling command:", error);
    }
  }

  async setupContextMenus() {
    try {
      // Remove existing context menus
      await chrome.contextMenus.removeAll();

      // Create context menu for input fields
      chrome.contextMenus.create({
        id: "fillCurrentField",
        title: "Fill this field",
        contexts: ["editable"],
        documentUrlPatterns: ["http://*/*", "https://*/*"],
      });

      // Create context menu for forms
      chrome.contextMenus.create({
        id: "fillCurrentForm",
        title: "Fill current form",
        contexts: ["page"],
        documentUrlPatterns: ["http://*/*", "https://*/*"],
      });

      // Create separator
      chrome.contextMenus.create({
        id: "separator1",
        type: "separator",
        contexts: ["editable", "page"],
        documentUrlPatterns: ["http://*/*", "https://*/*"],
      });

      // Create settings menu
      chrome.contextMenus.create({
        id: "openSettings",
        title: "Fake Form Filler Settings",
        contexts: ["editable", "page"],
        documentUrlPatterns: ["http://*/*", "https://*/*"],
      });

      // Handle context menu clicks
      chrome.contextMenus.onClicked.addListener((info, tab) => {
        this.handleContextMenuClick(info, tab);
      });
    } catch (error) {
      console.error("Error setting up context menus:", error);
    }
  }

  async handleContextMenuClick(info, tab) {
    try {
      switch (info.menuItemId) {
        case "fillCurrentField":
          await this.fillCurrentField(tab.id, info);
          break;

        case "fillCurrentForm":
          await this.fillCurrentForm(tab.id);
          break;

        case "openSettings":
          // Open extension popup or settings page
          chrome.action.openPopup();
          break;
      }
    } catch (error) {
      console.error("Error handling context menu click:", error);
    }
  }

  async fillCurrentField(tabId, info) {
    try {
      await this.injectContentScript(tabId);

      await chrome.scripting.executeScript({
        target: { tabId },
        func: targetInfo => {
          if (window.fakeFormFiller) {
            return window.fakeFormFiller.fillTargetField(targetInfo);
          }
          return { success: false, error: "Content script not loaded" };
        },
        args: [info],
      });
    } catch (error) {
      console.error("Error filling current field:", error);
    }
  }

  async fillCurrentForm(tabId) {
    try {
      await this.injectContentScript(tabId);

      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          if (window.fakeFormFiller) {
            return window.fakeFormFiller.fillForms();
          }
          return { success: false, error: "Content script not loaded" };
        },
      });
    } catch (error) {
      console.error("Error filling current form:", error);
    }
  }

  async initializeExtension() {
    // Perform any initialization tasks
    console.log("Initializing Fake Form Filler extension...");

    try {
      // Verify storage access
      await chrome.storage.sync.get(["autoFillEnabled"]);
      console.log("Storage access verified");
    } catch (error) {
      console.error("Storage access error:", error);
    }
  }
}

// Initialize the background service
new BackgroundService();
