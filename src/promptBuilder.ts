import OpenAI from "openai";
import type { PrismaClient } from "@prisma/client";
import type { KnowledgePack } from "./services/knowledgePacks";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

interface NicheTemplate {
  systemRules: string[];
  intakeQuestions: string[];
  qualificationFlows: { trigger: string[]; followUp: string }[];
  starterFaqs: { q: string; a: string }[];
  upsellRules: { trigger: string; suggestion: string }[];
  safetyRules: {
    escalateTriggers: string[];
    refuseTriggers: string[];
    refusalMessage?: string;
    escalationMessage?: string;
  };
}

interface BusinessContext {
  businessId: string;
  businessName: string | null;
  nicheId: string | null;
  languagePreference: string;
  tonePreference: string;
  template: NicheTemplate | null;
  nichePack: KnowledgePack | null;
  products: { name: string; price: number | null; currency: string; category: string | null }[];
  faqs: { question: string; answer: string }[];
  policies: {
    returnsPolicyText: string | null;
    warrantyPolicyText: string | null;
    deliveryPolicyText: string | null;
    paymentMethodsJson: any;
  } | null;
  knowledgeSources: { type: string; title: string; contentText: string }[];
  intakeAnswers: Record<string, string>;
  websiteFacts: Record<string, any>;
  missingCriticalFields: string[];
}

export interface MergedAIContext {
  businessId: string;
  businessName: string | null;
  nicheKey: string | null;
  nicheLabel: { en: string; sw: string } | null;
  languagePreference: string;
  tonePreference: string;
  primer: string | null;
  onboardingFields: any[];
  onboardingAnswers: Record<string, any>;
  websiteFacts: Record<string, any>;
  products: { name: string; price: number | null; currency: string; category: string | null }[];
  faqs: { question: string; answer: string }[];
  policies: any;
  knowledgeSources: { type: string; title: string; contentText: string }[];
  safetyRules: {
    neverInvent: string[];
    escalateIf: string[];
    style: string[];
  } | null;
  templates: any;
  missingCriticalFields: string[];
}

interface KnowledgePackServiceLike {
  getPack(nicheKey: string): KnowledgePack | null;
}

export function buildBusinessContext(
  profile: any,
  packService: KnowledgePackServiceLike
): MergedAIContext {
  const nicheKey = profile.nicheId || null;
  const pack = nicheKey ? packService.getPack(nicheKey) : null;
  const lang = profile.languagePreference === "sw" ? "sw" : "en";

  const intakeAnswers = (profile.intakeAnswers as Record<string, any>) || {};
  const websiteFacts = (profile.websiteFacts as Record<string, any>) || {};

  const missingCriticalFields: string[] = [];
  if (pack) {
    for (const field of pack.onboardingFields) {
      if (field.required && !intakeAnswers[field.key]) {
        missingCriticalFields.push(field.label[lang] || field.label.en);
      }
    }
  }

  return {
    businessId: profile.id,
    businessName: profile.businessName,
    nicheKey,
    nicheLabel: pack?.label || null,
    languagePreference: profile.languagePreference,
    tonePreference: profile.tonePreference,
    primer: pack ? pack.primer[lang] || pack.primer.en : null,
    onboardingFields: pack?.onboardingFields || [],
    onboardingAnswers: intakeAnswers,
    websiteFacts,
    products: (profile.products || []).map((p: any) => ({
      name: p.name,
      price: p.price,
      currency: p.currency,
      category: p.category,
    })),
    faqs: (profile.faqItems || []).map((f: any) => ({
      question: f.question,
      answer: f.answer,
    })),
    policies: profile.policies || null,
    knowledgeSources: (profile.knowledgeSources || []).map((k: any) => ({
      type: k.type,
      title: k.title,
      contentText: k.contentText,
    })),
    safetyRules: pack?.rules || null,
    templates: pack?.templates || null,
    missingCriticalFields,
  };
}

export async function loadBusinessContext(
  prisma: PrismaClient,
  connectionId: string,
  packService?: KnowledgePackServiceLike
): Promise<BusinessContext | null> {
  const connection = await prisma.whatsappConnection.findUnique({
    where: { id: connectionId },
    include: {
      businessProfile: {
        include: {
          niche: { include: { template: true } },
          products: { where: { isActive: true } },
          faqItems: { where: { isEnabled: true } },
          policies: true,
          knowledgeSources: { where: { isEnabled: true } },
        },
      },
    },
  });

  if (!connection?.businessProfile) {
    return null;
  }

  const profile = connection.businessProfile;
  const template = profile.niche?.template?.templateJson as NicheTemplate | null;
  const nichePack = packService && profile.nicheId ? packService.getPack(profile.nicheId) : null;

  const intakeAnswers = (profile.intakeAnswers as Record<string, string>) || {};
  const websiteFacts = (profile.websiteFacts as Record<string, any>) || {};

  const missingCriticalFields: string[] = [];
  if (nichePack) {
    for (const field of nichePack.onboardingFields) {
      if (field.required && !intakeAnswers[field.key]) {
        missingCriticalFields.push(field.label.en);
      }
    }
  }

  return {
    businessId: profile.id,
    businessName: profile.businessName,
    nicheId: profile.nicheId,
    languagePreference: profile.languagePreference,
    tonePreference: profile.tonePreference,
    template,
    nichePack,
    products: profile.products.map((p) => ({
      name: p.name,
      price: p.price,
      currency: p.currency,
      category: p.category,
    })),
    faqs: profile.faqItems.map((f) => ({
      question: f.question,
      answer: f.answer,
    })),
    policies: profile.policies,
    knowledgeSources: profile.knowledgeSources.map((k) => ({
      type: k.type,
      title: k.title,
      contentText: k.contentText,
    })),
    intakeAnswers,
    websiteFacts,
    missingCriticalFields,
  };
}

export function checkSafetyTriggers(
  text: string,
  template: NicheTemplate | null,
  nichePack?: KnowledgePack | null
): { shouldEscalate: boolean; shouldRefuse: boolean; message?: string } {
  const lowerText = text.toLowerCase();

  if (nichePack?.rules?.escalateIf) {
    for (const trigger of nichePack.rules.escalateIf) {
      if (lowerText.includes(trigger.replace(/_/g, " ").toLowerCase())) {
        return {
          shouldEscalate: true,
          shouldRefuse: false,
          message: "Let me connect you with someone who can help with this.",
        };
      }
    }
  }

  if (!template?.safetyRules) {
    return { shouldEscalate: false, shouldRefuse: false };
  }

  for (const trigger of template.safetyRules.refuseTriggers || []) {
    if (lowerText.includes(trigger.toLowerCase())) {
      return {
        shouldEscalate: false,
        shouldRefuse: true,
        message: template.safetyRules.refusalMessage || "I'm not able to help with that request. Please speak with our team directly.",
      };
    }
  }

  for (const trigger of template.safetyRules.escalateTriggers || []) {
    if (lowerText.includes(trigger.toLowerCase())) {
      return {
        shouldEscalate: true,
        shouldRefuse: false,
        message: template.safetyRules.escalationMessage || "Let me connect you with someone who can help better.",
      };
    }
  }

  return { shouldEscalate: false, shouldRefuse: false };
}

export function buildSystemPrompt(context: BusinessContext): string {
  const sections: string[] = [];

  sections.push("=== GLOBAL RULES ===");
  sections.push("- NEVER hallucinate or make up information");
  sections.push("- If you don't know something, ask for clarification");
  sections.push("- Never invent prices, stock levels, or policies");
  sections.push("- Always end your response with a clear next action or question");
  sections.push(`- Communicate in a ${context.tonePreference} tone`);
  sections.push(`- Primary language preference: ${context.languagePreference === "sw" ? "Swahili" : context.languagePreference === "mix" ? "Mix of Swahili and English" : "English"}`);

  if (context.nichePack) {
    const lang = context.languagePreference === "sw" ? "sw" : "en";
    sections.push("\n=== NICHE KNOWLEDGE PACK ===");
    sections.push(`Niche: ${context.nichePack.label[lang] || context.nichePack.label.en}`);
    sections.push(`Role: ${context.nichePack.primer[lang] || context.nichePack.primer.en}`);

    sections.push("\nNiche Style Rules:");
    for (const rule of context.nichePack.rules.style) {
      sections.push(`- ${rule}`);
    }

    sections.push("\nNEVER INVENT OR MAKE UP:");
    for (const item of context.nichePack.rules.neverInvent) {
      sections.push(`- ${item}`);
    }
    sections.push("If a customer asks about any of the above and the information is not available in your context, you MUST say 'Let me check and get back to you' or ask a clarifying question. NEVER make up values.");

    sections.push("\nESCALATE TO HUMAN IF:");
    for (const trigger of context.nichePack.rules.escalateIf) {
      sections.push(`- ${trigger.replace(/_/g, " ")}`);
    }
  }

  if (context.template) {
    sections.push("\n=== NICHE RULES ===");
    for (const rule of context.template.systemRules || []) {
      sections.push(`- ${rule}`);
    }

    if (context.template.qualificationFlows?.length > 0) {
      sections.push("\nQualification Flows:");
      for (const flow of context.template.qualificationFlows) {
        sections.push(`- When customer mentions [${flow.trigger.join(", ")}]: ${flow.followUp}`);
      }
    }

    if (context.template.upsellRules?.length > 0) {
      sections.push("\nUpsell Opportunities:");
      for (const rule of context.template.upsellRules) {
        sections.push(`- After ${rule.trigger}: "${rule.suggestion}"`);
      }
    }

    if (context.template.safetyRules) {
      sections.push("\nSafety Rules:");
      if (context.template.safetyRules.escalateTriggers?.length > 0) {
        sections.push(`- Escalate to human if customer mentions: ${context.template.safetyRules.escalateTriggers.join(", ")}`);
      }
      if (context.template.safetyRules.refuseTriggers?.length > 0) {
        sections.push(`- Refuse to answer and redirect if customer asks about: ${context.template.safetyRules.refuseTriggers.join(", ")}`);
      }
    }
  }

  sections.push("\n=== BUSINESS FACTS ===");
  if (context.businessName) {
    sections.push(`Business Name: ${context.businessName}`);
  }

  if (Object.keys(context.intakeAnswers).length > 0) {
    sections.push("\nOnboarding Answers:");
    for (const [question, answer] of Object.entries(context.intakeAnswers)) {
      sections.push(`${question}: ${answer}`);
    }
  }

  if (Object.keys(context.websiteFacts).length > 0) {
    sections.push("\nWebsite Facts:");
    for (const [key, value] of Object.entries(context.websiteFacts)) {
      if (typeof value === "string") {
        sections.push(`${key}: ${value}`);
      } else {
        sections.push(`${key}: ${JSON.stringify(value)}`);
      }
    }
  }

  if (context.missingCriticalFields.length > 0) {
    sections.push("\n=== MISSING INFORMATION WARNING ===");
    sections.push("The following critical business information has NOT been provided:");
    for (const field of context.missingCriticalFields) {
      sections.push(`- ${field}`);
    }
    sections.push("If a customer asks about any of these topics, you MUST NOT make up answers. Instead:");
    sections.push("1. Acknowledge you don't have that specific information yet");
    sections.push("2. Ask the customer 1-2 clarifying questions");
    sections.push("3. Offer to check and get back to them");
  }

  if (context.policies) {
    if (context.policies.deliveryPolicyText) {
      sections.push(`Delivery Policy: ${context.policies.deliveryPolicyText}`);
    }
    if (context.policies.returnsPolicyText) {
      sections.push(`Returns Policy: ${context.policies.returnsPolicyText}`);
    }
    if (context.policies.warrantyPolicyText) {
      sections.push(`Warranty Policy: ${context.policies.warrantyPolicyText}`);
    }
    if (context.policies.paymentMethodsJson && Array.isArray(context.policies.paymentMethodsJson) && context.policies.paymentMethodsJson.length > 0) {
      sections.push(`Payment Methods: ${context.policies.paymentMethodsJson.join(", ")}`);
    }
  }

  if (context.products.length > 0) {
    sections.push("\n=== CATALOG SUMMARY ===");
    const categories = new Map<string, typeof context.products>();
    for (const product of context.products.slice(0, 50)) {
      const cat = product.category || "Other";
      if (!categories.has(cat)) categories.set(cat, []);
      categories.get(cat)!.push(product);
    }

    for (const [category, products] of categories) {
      sections.push(`\n${category}:`);
      for (const p of products.slice(0, 10)) {
        const priceStr = p.price ? `${p.currency} ${p.price}` : "Price on request";
        sections.push(`  - ${p.name}: ${priceStr}`);
      }
    }

    if (context.products.length > 50) {
      sections.push(`\n(... and ${context.products.length - 50} more items)`);
    }
  } else {
    sections.push("\n=== CATALOG ===");
    sections.push("No products/services have been added yet. If a customer asks about specific products or prices, let them know you'll check with the business and get back to them.");
  }

  if (context.faqs.length > 0) {
    sections.push("\n=== FREQUENTLY ASKED QUESTIONS ===");
    for (const faq of context.faqs.slice(0, 20)) {
      sections.push(`Q: ${faq.question}`);
      sections.push(`A: ${faq.answer}`);
    }
  }

  for (const source of context.knowledgeSources) {
    if (source.type === "NOTES" || source.type === "DOCUMENT" || source.type === "WEBSITE") {
      sections.push(`\n=== ${source.title.toUpperCase()} ===`);
      sections.push(source.contentText.slice(0, 2000));
    }
  }

  return sections.join("\n");
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export async function generateAIResponse(
  context: BusinessContext,
  userMessage: string,
  conversationHistory: ConversationMessage[] = []
): Promise<string> {
  const systemPrompt = buildSystemPrompt(context);

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...conversationHistory.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user", content: userMessage },
  ];

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    max_tokens: 500,
    temperature: 0.7,
  });

  return response.choices[0]?.message?.content || "I'm sorry, I couldn't generate a response. Please try again.";
}

export { openai };
