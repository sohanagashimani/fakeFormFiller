// Entry for bundling official @faker-js/faker into a single IIFE bundle
// This exposes window.faker for use in content scripts
import { faker } from "@faker-js/faker";

// Debug what we're getting
console.log("Faker entry debug:", {
  fakerKeys: Object.keys(faker).slice(0, 10),
  person: !!faker.person,
  internet: !!faker.internet,
  lorem: !!faker.lorem,
  personKeys: faker.person
    ? Object.keys(faker.person).slice(0, 5)
    : "no person",
  testFirstName: faker.person?.firstName ? "has firstName" : "no firstName",
  testCall: faker.person?.firstName ? faker.person.firstName() : "call failed",
});

// Expose globally for IIFE
window.faker = faker;

// Also try direct assignment to catch any scope issues
if (typeof globalThis !== "undefined") {
  globalThis.faker = faker;
}
