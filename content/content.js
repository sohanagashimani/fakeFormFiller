// Content script for Fake Form Filler extension
(function () {
  "use strict";

  // Main class for form filling functionality
  class FakeFormFiller {
    constructor() {
      this.isInitialized = false;
      this.detectedForms = [];
      this.detectedFields = [];
      // Start with sane defaults so early calls don't crash
      this.settings = this.defaultSettings();
      this.fillSession = null;

      this.init();
    }

    isFieldEmpty(field) {
      const tag = (field.tagName || "").toLowerCase();
      const type = (field.type || "").toLowerCase();

      if (type === "checkbox" || type === "radio") {
        // consider unchecked as empty
        return !field.checked;
      }

      if (tag === "select") {
        // empty if no value or value equals placeholder empty string
        return !field.value || field.value.trim() === "";
      }

      // inputs and textareas
      const value = (field.value ?? "").toString();
      const isEmpty = value.trim() === "";

      // Debug logging for identificationMarks field
      if (field.name === "identificationMarks") {
        console.log("isFieldEmpty check for identificationMarks:", {
          tag,
          type,
          value: field.value,
          valueType: typeof field.value,
          isEmpty,
          field,
        });
      }

      return isEmpty;
    }

    async init() {
      if (this.isInitialized) return;

      try {
        // Load settings from background
        this.settings = await this.getSettings();

        // Set up mutation observer for dynamic content
        this.setupMutationObserver();

        // Wait for DOM to be fully ready before initial scan
        if (document.readyState === "loading") {
          await new Promise(resolve => {
            document.addEventListener("DOMContentLoaded", resolve, {
              once: true,
            });
          });
        }

        // Additional wait for dynamic content to load
        await this.waitForContent();

        // Initial scan
        await this.scanForms();

        this.isInitialized = true;
        console.log("Fake Form Filler initialized with ES module faker");
      } catch (error) {
        console.error("Error initializing Fake Form Filler:", error);
      }
    }

    async waitForContent() {
      // Wait for forms or form-like elements to appear
      let attempts = 0;
      const maxAttempts = 10;

      while (attempts < maxAttempts) {
        const hasForms =
          document.querySelector("form") ||
          document.querySelector("input, textarea, select");

        if (hasForms) {
          break;
        }

        await new Promise(resolve => setTimeout(resolve, 200));
        attempts++;
      }

      // Additional wait for any remaining dynamic content
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    defaultSettings() {
      return {
        autoFillEnabled: true,
        visualFeedbackEnabled: true,
        skipHiddenFields: true,
        fillDelay: 100,
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
    }

    async getSettings() {
      return new Promise(resolve => {
        chrome.runtime.sendMessage({ type: "GET_SETTINGS" }, response => {
          const defaults = this.defaultSettings();
          if (response && response.success) {
            const stored = response.settings || {};
            const merged = {
              ...defaults,
              ...stored,
              enabledFieldTypes: {
                ...defaults.enabledFieldTypes,
                ...(stored.enabledFieldTypes || {}),
              },
            };
            resolve(merged);
          } else {
            resolve(defaults);
          }
        });
      });
    }

    setupMutationObserver() {
      // Watch for DOM changes to detect dynamically added forms
      const observer = new MutationObserver(mutations => {
        let shouldRescan = false;

        mutations.forEach(mutation => {
          // Check added nodes
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (
                node.tagName === "FORM" ||
                node.querySelector("form") ||
                node.querySelector("input, textarea, select")
              ) {
                shouldRescan = true;
              }
            }
          });

          // Check attribute changes (for dynamic form loading)
          if (mutation.type === "attributes") {
            const target = mutation.target;
            if (
              target.tagName === "FORM" ||
              target.tagName === "INPUT" ||
              target.tagName === "TEXTAREA" ||
              target.tagName === "SELECT"
            ) {
              shouldRescan = true;
            }
          }

          // Check for subtree changes (nested form loading)
          if (
            mutation.type === "childList" &&
            mutation.target !== document.body
          ) {
            if (
              mutation.target.tagName === "FORM" ||
              mutation.target.querySelector("input, textarea, select")
            ) {
              shouldRescan = true;
            }
          }
        });

        if (shouldRescan) {
          // Debounce rescanning
          clearTimeout(this.rescanTimeout);
          this.rescanTimeout = setTimeout(() => {
            console.log("Dynamic content detected, rescanning forms...");
            this.scanForms(true);
          }, 300);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["style", "class", "data-*"],
      });
    }

    async scanForms(silent = false) {
      try {
        this.detectedForms = [];
        this.detectedFields = [];

        // Find all forms
        const forms = document.querySelectorAll("form");
        const standaloneFields = this.findStandaloneFields();

        // Process forms
        forms.forEach((form, index) => {
          const formData = this.analyzeForm(form, index);
          if (formData.fields.length > 0) {
            this.detectedForms.push(formData);
            this.detectedFields.push(...formData.fields);
          }
        });

        // Process standalone fields (not in forms)
        if (standaloneFields.length > 0) {
          const standaloneAnalyzed = standaloneFields
            .map(field => this.analyzeField(field))
            .filter(f => f && f.element);
          if (standaloneAnalyzed.length > 0) {
            const standaloneForm = {
              id: "standalone",
              element: document.body,
              fields: standaloneAnalyzed,
            };
            this.detectedForms.push(standaloneForm);
            this.detectedFields.push(...standaloneAnalyzed);
          }
        }

        // Ensure no nulls leaked into detectedFields
        this.detectedFields = this.detectedFields.filter(f => f && f.element);

        // If no forms found and this isn't a silent scan, try one more time after a delay
        if (this.detectedForms.length === 0 && !silent) {
          console.log("No forms found initially, retrying after delay...");
          await new Promise(resolve => setTimeout(resolve, 1000));

          // Retry scan
          const retryResult = await this.scanForms(true);
          if (retryResult.forms > 0) {
            console.log(`Retry successful: found ${retryResult.forms} forms`);
            return retryResult;
          }
        }

        if (!silent) {
          console.log(
            `Detected ${this.detectedForms.length} forms with ${this.detectedFields.length} total fields`
          );
        }

        return {
          forms: this.detectedForms.length,
          fields: this.detectedFields.length,
        };
      } catch (error) {
        console.error("Error scanning forms:", error);
        return { forms: 0, fields: 0, error: error.message };
      }
    }

    findStandaloneFields() {
      const allFields = document.querySelectorAll("input, textarea, select");
      const standaloneFields = [];

      allFields.forEach(field => {
        // Skip if field is inside a form
        if (field.closest("form")) {
          return;
        }

        // Special handling for Ant Design fields that might not be in forms
        const isAntDesign =
          field.classList.contains("ant-input") ||
          field.closest(".ant-form-item") ||
          field.closest(".ant-input-wrapper");

        // Include standalone fields and Ant Design fields
        if (!field.closest("form") || isAntDesign) {
          standaloneFields.push(field);
        }
      });

      return standaloneFields;
    }

    analyzeForm(form, index) {
      const fields = form
        ? form.querySelectorAll("input, textarea, select")
        : [];
      const analyzedFields = [];

      fields.forEach(field => {
        const fieldData = this.analyzeField(field);
        if (fieldData) {
          analyzedFields.push(fieldData);
        }
      });

      return {
        id: form.id || `form-${index}`,
        element: form,
        action: form.action || "",
        method: form.method || "get",
        fields: analyzedFields,
      };
    }

    analyzeField(field) {
      if (!field || !this.isFieldFillable(field)) {
        return null;
      }

      const fieldType = this.detectFieldType(field);
      const fieldName = this.getFieldIdentifier(field);

      // Debug logging for problematic fields
      if (
        field.name === "identificationMarks" ||
        field.placeholder?.includes("Identification Marks")
      ) {
        console.log("Found identificationMarks field:", {
          field,
          fieldType,
          fieldName,
          isFillable: this.isFieldFillable(field),
          isEmpty: this.isFieldEmpty(field),
          tagName: field.tagName,
          type: field.type,
          name: field.name,
          placeholder: field.placeholder,
        });
      }

      return {
        element: field,
        type: field.type || field.tagName.toLowerCase(),
        detectedType: fieldType,
        name: fieldName,
        id: field.id || "",
        placeholder: field.placeholder || "",
        required: field.required || false,
        readonly: field.readOnly || false,
        disabled: field.disabled || false,
        maxLength: field.maxLength || field.getAttribute("maxlength") || null,
        pattern: field.pattern || null,
        autocomplete: field.autocomplete || "",
        labels: this.getFieldLabels(field),
      };
    }

    isFieldFillable(field) {
      // Skip if field type is disabled in settings (use base type)
      const detectedType = this.detectFieldType(field);
      const baseType = this.getBaseType(field, detectedType);

      // Never fill date-like fields regardless of underlying input type
      if (detectedType === "date") {
        return false;
      }
      const enabledMap =
        (this.settings && this.settings.enabledFieldTypes) || {};
      if (!enabledMap[baseType]) {
        return false;
      }

      // Skip hidden fields if setting is enabled
      if (this.settings.skipHiddenFields) {
        const style = window.getComputedStyle(field);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          field.type === "hidden" ||
          field.offsetParent === null
        ) {
          return false;
        }
      }

      // Skip known non-fillable/security fields
      const n = (field.name || "").toLowerCase();
      const i = (field.id || "").toLowerCase();
      if (
        n.includes("captcha") ||
        i.includes("captcha") ||
        n.includes("recaptcha") ||
        i.includes("recaptcha")
      ) {
        return false;
      }

      // Skip disabled or readonly fields
      if (field.disabled || field.readOnly) {
        return false;
      }

      // Skip fields with explicit no-autofill attribute
      if (field.hasAttribute("data-no-autofill")) {
        return false;
      }

      // Only fill if the field is currently empty
      const isEmpty = this.isFieldEmpty(field);
      if (!isEmpty) {
        return false;
      }

      return true;
    }

    getBaseType(field, detectedType) {
      const tag = (field.tagName || "").toLowerCase();
      const type = (field.type || "").toLowerCase();

      if (tag === "textarea") return "textarea";
      if (type === "email") return "email";
      if (type === "password") return "password";
      if (type === "tel") return "tel";
      if (type === "url") return "url";
      // Skip date fields entirely
      if (type === "date" || type === "datetime-local") return "date_disabled";
      if (type === "number" || type === "range") return "number";
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (tag === "select") return "select";

      // Map semantic types to a base type
      const semanticToBase = {
        firstName: "text",
        lastName: "text",
        middleName: "text",
        fullName: "text",
        streetAddress: "text",
        city: "text",
        state: "text",
        zipCode: "text",
        country: "text",
        company: "text",
        jobTitle: "text",
        creditCard: "text",
        paragraph: "textarea",
        phone: "tel",
      };

      return semanticToBase[detectedType] || "text";
    }

    randomInt(min, max) {
      try {
        if (window.faker?.number?.int) {
          return window.faker.number.int({ min, max });
        }
      } catch (_) {}
      return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    detectFieldType(field) {
      const type = (field.type || "").toLowerCase();
      const name = (field.name || "").toLowerCase();
      const id = (field.id || "").toLowerCase();
      const placeholder = (field.placeholder || "").toLowerCase();
      const autocomplete = (field.autocomplete || "").toLowerCase();
      const className = (field.className || "").toLowerCase();
      const labels = this.getFieldLabels(field).join(" ").toLowerCase();

      // Combine all text sources for analysis
      const allText = `${name} ${id} ${placeholder} ${autocomplete} ${className} ${labels}`;

      // Email detection
      if (type === "email" || /email|e-mail/.test(allText)) {
        return "email";
      }

      // Password detection
      if (type === "password" || /password|pwd|pass/.test(allText)) {
        return "password";
      }

      // Phone detection
      if (type === "tel" || /phone|tel|mobile|cell/.test(allText)) {
        return "phone";
      }

      // URL detection
      if (type === "url" || /url|website|homepage|link/.test(allText)) {
        return "url";
      }

      // Date detection (but we skip date fields, so this won't be used for filling)
      if (
        type === "date" ||
        type === "datetime-local" ||
        /date|birth|dob|birthday/.test(allText)
      ) {
        return "date";
      }

      // Number detection
      if (
        type === "number" ||
        type === "range" ||
        /age|year|amount|price|quantity|count|number/.test(allText)
      ) {
        return "number";
      }

      // Name detection
      if (/name|firstname|lastname|fullname|givenname|surname/.test(allText)) {
        if (/first|given/.test(allText)) return "firstName";
        if (/last|sur|family/.test(allText)) return "lastName";
        if (/middle/.test(allText)) return "middleName";
        if (/full|complete/.test(allText)) return "fullName";
        return "firstName"; // Default to first name
      }

      // Address detection
      if (/address|street|city|state|zip|postal|country/.test(allText)) {
        if (/street|address1|addr1/.test(allText)) return "streetAddress";
        if (/city|town/.test(allText)) return "city";
        if (/state|province|region/.test(allText)) return "state";
        if (/zip|postal/.test(allText)) return "zipCode";
        if (/country/.test(allText)) return "country";
        return "streetAddress"; // Default to street address
      }

      // Company detection
      if (/company|organization|employer|business/.test(allText)) {
        return "company";
      }

      // Job title detection
      if (/job|title|position|role|occupation/.test(allText)) {
        return "jobTitle";
      }

      // Credit card detection
      if (/credit|card|cc|cardnumber/.test(allText)) {
        return "creditCard";
      }

      // Textarea detection
      if (field.tagName.toLowerCase() === "textarea") {
        if (/comment|message|description|bio|about/.test(allText)) {
          return "paragraph";
        }
        return "paragraph";
      }

      // Select detection
      if (field.tagName.toLowerCase() === "select") {
        return "select";
      }

      // Checkbox detection
      if (type === "checkbox") {
        return "checkbox";
      }

      // Radio detection
      if (type === "radio") {
        return "radio";
      }

      // Default to text
      return "text";
    }

    getFieldIdentifier(field) {
      return field.name || field.id || field.placeholder || "unnamed-field";
    }

    getFieldLabels(field) {
      const labels = [];

      // Direct label association
      if (field.id) {
        const label = document.querySelector(`label[for="${field.id}"]`);
        if (label) {
          labels.push(label.textContent.trim());
        }
      }

      // Parent label
      const parentLabel = field.closest("label");
      if (parentLabel) {
        labels.push(parentLabel.textContent.trim());
      }

      // Preceding text (common pattern)
      const prevSibling = field.previousElementSibling;
      if (
        prevSibling &&
        (prevSibling.tagName === "LABEL" || prevSibling.tagName === "SPAN")
      ) {
        labels.push(prevSibling.textContent.trim());
      }

      return labels.filter(label => label.length > 0);
    }

    getFallbackData(fieldType, field = null) {
      // Simple fallback data when faker isn't available
      const fallbacks = {
        email: "test@example.com",
        password: "TempPass123!",
        phone: "+1 555 123 4567",
        url: "https://example.com",
        firstName: "Alex",
        lastName: "Smith",
        middleName: "Lee",
        fullName: "Alex Smith",
        streetAddress: "123 Main St",
        city: "Springfield",
        state: "CA",
        zipCode: "90210",
        country: "United States",
        company: "Acme Corp",
        jobTitle: "Engineer",
        creditCard: "4111111111111111",
        date: new Date().toISOString().split("T")[0],
        number: Math.floor(Math.random() * 100) + 1,
        paragraph: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
        text: "Sample Text",
      };

      return fallbacks[fieldType] || "Sample Data";
    }

    generateFakeData(fieldType, field = null) {
      if (!window.faker) {
        console.error("Faker.js not available on window");
        return this.getFallbackData(fieldType, field);
      }

      try {
        const faker = window.faker;

        switch (fieldType) {
          case "date":
            // Explicitly never generate for date fields to keep them empty
            return "";
          case "email":
            return faker.internet?.email
              ? faker.internet.email()
              : `user${Math.floor(Math.random() * 1000)}@example.com`;

          case "password":
            return faker.internet?.password
              ? faker.internet.password()
              : Math.random().toString(36).slice(2) + "A1!";

          case "phone":
            return faker.phone?.number
              ? faker.phone.number()
              : `+1 ${Math.floor(100 + Math.random() * 900)} ${Math.floor(
                  100 + Math.random() * 900
                )} ${Math.floor(1000 + Math.random() * 9000)}`;

          case "url":
            return faker.internet?.url
              ? faker.internet.url()
              : `https://www.example.com/${Math.floor(Math.random() * 1000)}`;

          case "firstName":
            return faker.person?.firstName
              ? faker.person.firstName()
              : faker.name?.firstName
              ? faker.name.firstName()
              : "Alex";

          case "lastName":
            return faker.person?.lastName
              ? faker.person.lastName()
              : faker.name?.lastName
              ? faker.name.lastName()
              : "Smith";

          case "middleName":
            return faker.person?.middleName
              ? faker.person.middleName()
              : faker.name?.middleName
              ? faker.name.middleName()
              : "Lee";

          case "fullName":
            return faker.person?.fullName
              ? faker.person.fullName()
              : `${this.generateFakeData("firstName")} ${this.generateFakeData(
                  "lastName"
                )}`;

          case "streetAddress":
            return faker.location?.streetAddress
              ? faker.location.streetAddress()
              : faker.address?.streetAddress
              ? faker.address.streetAddress()
              : "123 Main St";

          case "city":
            return faker.location?.city
              ? faker.location.city()
              : faker.address?.city
              ? faker.address.city()
              : "Springfield";

          case "state":
            return faker.location?.state
              ? faker.location.state()
              : faker.address?.state
              ? faker.address.state()
              : "CA";

          case "zipCode":
            return faker.location?.zipCode
              ? faker.location.zipCode()
              : faker.address?.zipCode
              ? faker.address.zipCode()
              : "90210";

          case "country":
            return faker.location?.country
              ? faker.location.country()
              : faker.address?.country
              ? faker.address.country()
              : "United States";

          case "company":
            return faker.company?.name ? faker.company.name() : "Acme Corp";

          case "jobTitle":
            return faker.person?.jobTitle
              ? faker.person.jobTitle()
              : "Engineer";

          case "creditCard":
            return faker.finance?.creditCardNumber
              ? faker.finance.creditCardNumber()
              : Array.from({ length: 16 }, () =>
                  Math.floor(Math.random() * 10)
                ).join("");

          case "number":
            if (field) {
              if ((field.name || "").includes("aadhaarNumber")) {
                return faker.string?.numeric
                  ? faker.string.numeric(12)
                  : Array.from({ length: 12 }, () =>
                      Math.floor(Math.random() * 10)
                    ).join("");
              }
              if (field.name.includes("yearsAttended")) {
                return faker.number.int({ min: 1, max: 15 });
              }
              const hasMin = field.min !== undefined && field.min !== "";
              const hasMax = field.max !== undefined && field.max !== "";
              const maxLength =
                Number.isFinite(field.maxLength) && field.maxLength > 0
                  ? field.maxLength
                  : field.getAttribute("maxlength")
                  ? parseInt(field.getAttribute("maxlength"), 10)
                  : null;

              let min = hasMin ? parseInt(field.min, 10) : 0;
              let max;
              if (hasMax) {
                max = parseInt(field.max, 10);
              } else if (maxLength) {
                // Honor maxlength for numeric fields by limiting digit count
                const safeDigits = Math.min(maxLength, 12); // cap to avoid huge numbers/exponent
                max = Math.pow(10, safeDigits) - 1;
              } else {
                max = min + 100;
              }
              if (max < min) max = min;
              // Always return as string to avoid scientific notation rendering
              return faker.number.int({ min, max });
            }

            return faker.number.int({ min: 1, max: 100 });

          case "paragraph":
            let paragraph = faker.lorem?.paragraph
              ? faker.lorem.paragraph()
              : "Lorem ipsum dolor sit amet, consectetur adipiscing elit.";

            // For textareas, generate appropriate text length based on maxLength
            // Check both maxLength property and maxlength attribute
            const maxLength =
              field?.maxLength ||
              (field?.getAttribute && field.getAttribute("maxlength")) ||
              null;

            // Also check for any text that might indicate the actual limit
            let actualLimit = maxLength;
            if (field) {
              // Look for text that mentions character limits (like "max 100 characters")
              const parentText = field.parentElement?.textContent || "";
              const charLimitMatch = parentText.match(
                /max\s+(\d+)\s+characters?/i
              );
              if (charLimitMatch) {
                const textLimit = parseInt(charLimitMatch[1], 10);
                if (!isNaN(textLimit) && textLimit > 0) {
                  actualLimit = Math.min(actualLimit || Infinity, textLimit);
                  console.log(
                    `Found text-based limit: ${textLimit} for field ${
                      field.name || field.id
                    }`
                  );
                }
              }
            }

            if (field && actualLimit && actualLimit > 0) {
              const maxLen = parseInt(actualLimit, 10);
              if (!isNaN(maxLen)) {
                if (maxLen < 50) {
                  // For very short limits, use words instead of paragraph
                  paragraph = faker.lorem?.words
                    ? faker.lorem
                        .words(Math.min(Math.floor(maxLen / 5), 10))
                        .join(" ")
                    : "Sample text";
                } else if (maxLen < 200) {
                  // For medium limits, use sentence instead of paragraph
                  paragraph = faker.lorem?.sentence
                    ? faker.lorem.sentence({
                        wordCount: Math.min(Math.floor(maxLen / 8), 20),
                      })
                    : "Sample sentence text.";
                }
                // Ensure the generated text fits within the limit
                if (paragraph.length > maxLen) {
                  paragraph = paragraph.substring(0, maxLen);
                }
              }
            }

            return paragraph;

          case "select":
            return this.handleSelectField(field);

          case "checkbox":
            // For checkboxes, we need to set the checked property, not the value
            // Return true/false for the checked state
            const checkboxValue = Math.random() > 0.5;
            return checkboxValue;

          case "radio":
            return Math.random() > 0.5;

          case "text":
          default:
            // Try to guess based on field attributes
            const name = field ? field.name.toLowerCase() : "";
            if (name.includes("username")) {
              return faker.internet?.userName
                ? faker.internet.userName()
                : `user_${this.randomInt(1000, 9999)}`;
            }
            if (name.includes("age")) return this.randomInt(18, 80);
            return faker.lorem?.words ? faker.lorem.words(2) : "Sample Text";
        }
      } catch (error) {
        console.error("Error generating fake data:", error);
        return "Sample Data";
      }
    }

    handleSelectField(field) {
      if (!field || !field.options || field.options.length === 0) {
        return "";
      }

      // Skip the first option if it's a placeholder (empty value)
      const validOptions = Array.from(field.options).filter(
        option =>
          option.value &&
          option.value.trim() !== "" &&
          option.textContent.trim() !== ""
      );

      if (validOptions.length === 0) {
        return "";
      }

      const randomOption =
        validOptions[Math.floor(Math.random() * validOptions.length)];
      return randomOption.value;
    }

    applyConstraints(field, value, fieldType) {
      try {
        if (value == null) return value;

        const maxLengthAttr =
          field.getAttribute && field.getAttribute("maxlength");
        const maxLength = maxLengthAttr
          ? parseInt(maxLengthAttr, 10)
          : field.maxLength || 0;

        // Respect maxlength for text-like inputs and textareas
        if (
          typeof value === "string" &&
          ((field.tagName && field.tagName.toLowerCase() === "textarea") ||
            field.type === "text" ||
            field.type === "email" ||
            field.type === "url" ||
            field.type === "password" ||
            field.type === "search" ||
            field.type === "tel")
        ) {
          if (
            Number.isFinite(maxLength) &&
            maxLength > 0 &&
            value.length > maxLength
          ) {
            value = value.slice(0, maxLength);
          }
        }

        // Constrain numbers to min/max if provided
        if (field.type === "number") {
          const min = field.min !== "" ? Number(field.min) : undefined;
          const max = field.max !== "" ? Number(field.max) : undefined;
          let num = typeof value === "number" ? value : Number(value);
          if (!Number.isNaN(num)) {
            if (min !== undefined && num < min) num = min;
            if (max !== undefined && num > max) num = max;
            value = num;
          }
        }

        // For date inputs, ensure value matches yyyy-mm-dd and respect min/max if present
        if (field.type === "date" && typeof value === "string") {
          const isISO = /^\d{4}-\d{2}-\d{2}$/.test(value);
          if (!isISO && value) {
            const d = new Date(value);
            if (!isNaN(d.getTime())) {
              value = d.toISOString().split("T")[0];
            }
          }
          const min = field.min ? new Date(field.min) : undefined;
          const max = field.max ? new Date(field.max) : undefined;
          const dv = new Date(value);
          if (!isNaN(dv.getTime())) {
            if (min && dv < min) value = field.min;
            if (max && dv > max) value = field.max;
          }
        }

        return value;
      } catch (e) {
        return value;
      }
    }

    async fillForms(options = {}) {
      try {
        const startTime = Date.now();
        this.fillSession = {
          startTime,
          fieldsProcessed: 0,
          fieldsSkipped: 0,
          errors: [],
        };

        // Merge options with current settings
        const fillOptions = {
          ...this.settings,
          ...options,
        };

        // Re-scan after any prior clear/DOM changes to get fresh fields
        await this.scanForms(true);

        let totalFields = 0;
        let processedFields = 0;

        // Count total fillable and currently empty fields
        this.detectedFields.forEach(fieldData => {
          if (
            fieldData &&
            fieldData.element &&
            this.isFieldFillable(fieldData.element) &&
            this.isFieldEmpty(fieldData.element)
          ) {
            totalFields++;
          }
        });

        if (totalFields === 0) {
          return {
            success: true,
            fieldsProcessed: 0,
            fieldsSkipped: this.detectedFields.length,
            duration: Date.now() - startTime,
            errors: [],
          };
        }

        // Fill fields with visual feedback
        for (const fieldData of this.detectedFields) {
          if (
            !fieldData ||
            !fieldData.element ||
            !this.isFieldFillable(fieldData.element) ||
            !this.isFieldEmpty(fieldData.element)
          ) {
            // Debug logging for skipped fields
            if (
              fieldData &&
              fieldData.element &&
              fieldData.element.name === "identificationMarks"
            ) {
              console.log("Skipping identificationMarks field:", {
                isFillable: this.isFieldFillable(fieldData.element),
                isEmpty: this.isFieldEmpty(fieldData.element),
                field: fieldData.element,
              });
            }

            this.fillSession.fieldsSkipped++;
            continue;
          }

          try {
            await this.fillField(fieldData, fillOptions);
            processedFields++;
            this.fillSession.fieldsProcessed++;

            // Update progress
            const progress = Math.round((processedFields / totalFields) * 100);
            this.sendProgress(progress);

            // Add delay between fills for better UX
            if (fillOptions.fillDelay > 0) {
              await this.delay(fillOptions.fillDelay);
            }
          } catch (error) {
            console.error("Error filling field:", error);
            this.fillSession.errors.push({
              field: fieldData.name,
              error: error.message,
            });
          }
        }

        const endTime = Date.now();
        const duration = endTime - startTime;

        console.log(
          `Form filling completed in ${duration}ms. Processed: ${processedFields}, Skipped: ${this.fillSession.fieldsSkipped}`
        );

        return {
          success: true,
          fieldsProcessed: processedFields,
          fieldsSkipped: this.fillSession.fieldsSkipped,
          duration,
          errors: this.fillSession.errors,
        };
      } catch (error) {
        console.error("Error during form filling:", error);
        return { success: false, error: error.message };
      }
    }

    async fillField(fieldData, options) {
      const field = fieldData.element;
      const fieldType = fieldData.detectedType;

      // Generate appropriate fake data
      let fakeData = this.generateFakeData(fieldType, field);
      // Apply field constraints like maxlength/min/max
      fakeData = this.applyConstraints(field, fakeData, fieldType);

      // Add visual feedback if enabled
      if (options.visualFeedback) {
        this.addVisualFeedback(field);
      }

      // Fill the field based on its type
      switch (field.type) {
        case "checkbox":
          const isAntDesign =
            field.closest(".ant-checkbox-wrapper") ||
            field.classList.contains("ant-checkbox-input");

          // Handle Ant Design checkboxes specially
          if (
            field.closest(".ant-checkbox-wrapper") ||
            field.classList.contains("ant-checkbox-input")
          ) {
            // For Ant Design, we need to trigger the change event to update the UI
            field.checked = fakeData;

            // Try multiple approaches to ensure the UI updates
            try {
              // Method 1: Trigger click event
              field.click();

              // Method 2: Trigger change event
              field.dispatchEvent(new Event("change", { bubbles: true }));

              // Method 3: Trigger input event
              field.dispatchEvent(new Event("input", { bubbles: true }));

              // Method 4: Force a re-render by toggling and setting back
              if (fakeData) {
                // If we want it checked, ensure it's checked
                field.checked = true;
                // Also try to update the parent span's class
                const checkboxSpan = field.closest(".ant-checkbox");
                if (checkboxSpan) {
                  checkboxSpan.classList.add("ant-checkbox-checked");
                }
              } else {
                // If we want it unchecked, ensure it's unchecked
                field.checked = false;
                const checkboxSpan = field.closest(".ant-checkbox");
                if (checkboxSpan) {
                  checkboxSpan.classList.remove("ant-checkbox-checked");
                }
              }

              // Method 5: Trigger a custom event that Ant Design might be listening for
              field.dispatchEvent(
                new Event("ant-checkbox-change", { bubbles: true })
              );
            } catch (error) {
              console.error(`Error updating Ant Design checkbox:`, error);
            }
          } else {
            // Standard checkbox handling
            field.checked = fakeData;
          }
          break;

        case "radio":
          if (fakeData) {
            field.checked = true;
          }
          break;

        case "select-one":
        case "select-multiple":
          if (fakeData) {
            field.value = fakeData;
          }
          break;

        default: {
          if (typeof fakeData === "string" || typeof fakeData === "number") {
            const newValue = String(fakeData);
            const tag = (field.tagName || "").toLowerCase();
            try {
              let setter = null;
              if (tag === "textarea") {
                setter = Object.getOwnPropertyDescriptor(
                  window.HTMLTextAreaElement.prototype,
                  "value"
                )?.set;
              } else if (tag === "input") {
                setter = Object.getOwnPropertyDescriptor(
                  window.HTMLInputElement.prototype,
                  "value"
                )?.set;
              }
              if (setter) {
                setter.call(field, newValue);
              } else {
                field.value = newValue;
              }
            } catch (_) {
              field.value = newValue;
            }
          }
          break;
        }
      }

      // Trigger change events to notify any JavaScript listeners
      this.triggerChangeEvents(field);

      // Remove visual feedback after a delay
      if (options.visualFeedback) {
        setTimeout(() => {
          this.removeVisualFeedback(field);
        }, 1000);
      }
    }

    addVisualFeedback(field) {
      field.style.outline = "2px solid #4CAF50";
      field.style.backgroundColor = "#e8f5e8";
    }

    removeVisualFeedback(field) {
      field.style.outline = "";
      field.style.backgroundColor = "";
    }

    triggerChangeEvents(field) {
      // Standard events
      const events = ["input", "change", "blur"];

      events.forEach(eventType => {
        const event = new Event(eventType, { bubbles: true, cancelable: true });
        field.dispatchEvent(event);
      });

      // Enhanced React/Vue/Framework compatibility
      if (
        field._valueTracker ||
        field.__reactInternalInstance ||
        field.dataset.reactid ||
        field.hasAttribute("data-reactroot")
      ) {
        // Use the correct native value setter based on element type
        const setter =
          (field.tagName && field.tagName.toLowerCase() === "textarea"
            ? Object.getOwnPropertyDescriptor(
                window.HTMLTextAreaElement.prototype,
                "value"
              )?.set
            : Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype,
                "value"
              )?.set) || null;
        try {
          if (setter) setter.call(field, field.value);
        } catch (_) {}

        // Trigger additional React-specific input event
        const inputEvent = new Event("input", { bubbles: true });
        field.dispatchEvent(inputEvent);
      }

      // Try to trigger any custom validation that might be attached
      if (field.checkValidity && typeof field.checkValidity === "function") {
        field.checkValidity();
      }
    }

    async clearForms() {
      try {
        // Clear ALL fields in the document, regardless of prior detection/fillability
        const allFields = Array.from(
          document.querySelectorAll("input, textarea, select")
        );

        let clearedFields = 0;

        allFields.forEach(field => {
          if (!field) return;
          if (field.disabled || field.readOnly) return;

          const nameLower = (field.name || "").toLowerCase();
          const idLower = (field.id || "").toLowerCase();
          if (
            nameLower.includes("captcha") ||
            idLower.includes("captcha") ||
            nameLower.includes("recaptcha") ||
            idLower.includes("recaptcha")
          ) {
            return;
          }

          const tag = (field.tagName || "").toLowerCase();
          const type = (field.type || "").toLowerCase();

          // Skip non-data inputs
          const skipTypes = ["button", "submit", "reset", "image", "file"]; // do not attempt to clear file inputs
          if (skipTypes.includes(type)) return;

          try {
            if (type === "checkbox" || type === "radio") {
              field.checked = false;
            } else if (tag === "select") {
              // Prefer empty option if present, otherwise clear value
              const emptyOption = Array.from(field.options || []).find(
                o => o.value === ""
              );
              if (emptyOption) {
                field.value = "";
              } else if (field.options && field.options.length > 0) {
                field.selectedIndex = -1; // no selection
              } else {
                field.value = "";
              }
            } else {
              // Use native setter for compatibility with frameworks
              const nativeSetter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype,
                "value"
              )?.set;
              if (nativeSetter && tag === "input") {
                nativeSetter.call(field, "");
              } else {
                field.value = "";
              }
            }

            this.triggerChangeEvents(field);
            clearedFields++;
          } catch (e) {
            // Best-effort clear; ignore individual field errors
          }
        });

        console.log("clearForms: completed", { clearedFields });
        try {
          chrome.runtime.sendMessage({
            type: "CLEAR_COMPLETE",
            fieldsCleared: clearedFields,
          });
        } catch (_) {}
        return { success: true, fieldsCleared: clearedFields };
      } catch (error) {
        console.error("Error clearing forms:", error);
        return { success: false, error: error.message };
      }
    }

    sendProgress(progress) {
      chrome.runtime.sendMessage({
        type: "FILL_PROGRESS",
        progress: progress,
      });
    }

    delay(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Public methods for extension communication
    scanFormsPublic() {
      return this.scanForms();
    }

    fillFormsPublic(options) {
      return this.fillForms(options);
    }

    clearFormsPublic() {
      return this.clearForms();
    }

    fillTargetField(targetInfo) {
      // Implementation for filling a specific field from context menu
      // This would use the targetInfo to identify the specific field
      console.log("Fill target field:", targetInfo);
      return { success: true };
    }

    fillCurrentForm() {
      // Implementation for filling just the current form
      console.log("Fill current form");
      return { success: true };
    }
  }

  // Initialize the extension
  let fakeFormFillerInstance = null;

  function initializeFakeFormFiller() {
    if (!fakeFormFillerInstance) {
      fakeFormFillerInstance = new FakeFormFiller();
    }
    return fakeFormFillerInstance;
  }

  // Expose API to global scope for background script communication
  window.fakeFormFiller = {
    scanForms: () => {
      const instance = initializeFakeFormFiller();
      return instance.scanFormsPublic();
    },
    fillForms: options => {
      const instance = initializeFakeFormFiller();
      return instance.fillFormsPublic(options);
    },
    clearForms: () => {
      const instance = initializeFakeFormFiller();
      return instance.clearFormsPublic();
    },
    fillTargetField: targetInfo => {
      const instance = initializeFakeFormFiller();
      return instance.fillTargetField(targetInfo);
    },
    fillCurrentForm: () => {
      const instance = initializeFakeFormFiller();
      return instance.fillCurrentForm();
    },
  };

  // Auto-initialize if the DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeFakeFormFiller);
  } else {
    initializeFakeFormFiller();
  }
})();
