import fs from "fs";
import path from "path";

export interface NicheLabel {
  en: string;
  sw: string;
}

export interface NicheIntent {
  key: string;
  description: NicheLabel;
  exampleQuestions: string[];
  responseTemplate: NicheLabel;
}

export interface OnboardingFieldOption {
  value: string;
  label: NicheLabel;
}

export interface OnboardingField {
  key: string;
  type: "select" | "text" | "multi" | "multi-select" | "boolean" | "textarea" | "number";
  required: boolean;
  label: NicheLabel;
  help?: NicheLabel;
  options?: OnboardingFieldOption[];
  placeholder?: NicheLabel;
  visibleIf?: { field: string; value: any };
  max?: number;
}

export interface NicheRules {
  neverInvent: string[];
  escalateIf: string[];
  style: string[];
}

export interface NicheTemplates {
  orderConfirm: NicheLabel;
  availabilityCheck: NicheLabel;
  quoteRequest: NicheLabel;
  [key: string]: NicheLabel;
}

export interface KnowledgePack {
  key: string;
  label: NicheLabel;
  primer: NicheLabel;
  intents: NicheIntent[];
  onboardingFields: OnboardingField[];
  rules: NicheRules;
  templates: NicheTemplates;
}

export interface NicheSummary {
  key: string;
  label: NicheLabel;
}

const REQUIRED_FIELDS: (keyof KnowledgePack)[] = [
  "key",
  "label",
  "primer",
  "intents",
  "onboardingFields",
  "rules",
  "templates",
];

class KnowledgePackService {
  private packs: Map<string, KnowledgePack> = new Map();
  private loaded = false;

  loadAll(): void {
    const nichesDir = path.join(__dirname, "../knowledge/niches");

    if (!fs.existsSync(nichesDir)) {
      console.warn(`Knowledge packs directory not found: ${nichesDir}`);
      return;
    }

    const files = fs.readdirSync(nichesDir).filter((f) => f.endsWith(".json"));

    for (const file of files) {
      try {
        const filePath = path.join(nichesDir, file);
        const raw = fs.readFileSync(filePath, "utf-8");
        const pack: KnowledgePack = JSON.parse(raw);

        const errors = this.validate(pack, file);
        if (errors.length > 0) {
          console.warn(`Validation errors in ${file}:`, errors);
          continue;
        }

        this.packs.set(pack.key, pack);
      } catch (err) {
        console.error(`Failed to load knowledge pack ${file}:`, err);
      }
    }

    this.loaded = true;
    console.log(
      `Loaded ${this.packs.size} knowledge packs: ${[...this.packs.keys()].join(", ")}`
    );
  }

  private validate(pack: any, filename: string): string[] {
    const errors: string[] = [];

    for (const field of REQUIRED_FIELDS) {
      if (pack[field] === undefined || pack[field] === null) {
        errors.push(`Missing required field: ${field} in ${filename}`);
      }
    }

    if (pack.label && (!pack.label.en || !pack.label.sw)) {
      errors.push(`Label must have 'en' and 'sw' in ${filename}`);
    }

    if (pack.primer && (!pack.primer.en || !pack.primer.sw)) {
      errors.push(`Primer must have 'en' and 'sw' in ${filename}`);
    }

    if (pack.rules) {
      if (!Array.isArray(pack.rules.neverInvent)) {
        errors.push(`rules.neverInvent must be an array in ${filename}`);
      }
      if (!Array.isArray(pack.rules.escalateIf)) {
        errors.push(`rules.escalateIf must be an array in ${filename}`);
      }
    }

    return errors;
  }

  getAllNiches(): NicheSummary[] {
    if (!this.loaded) this.loadAll();
    return [...this.packs.values()].map((p) => ({
      key: p.key,
      label: p.label,
    }));
  }

  getPack(nicheKey: string): KnowledgePack | null {
    if (!this.loaded) this.loadAll();
    return this.packs.get(nicheKey) || null;
  }

  getAllPacks(): KnowledgePack[] {
    if (!this.loaded) this.loadAll();
    return [...this.packs.values()];
  }

  isLoaded(): boolean {
    return this.loaded;
  }
}

export const knowledgePackService = new KnowledgePackService();
