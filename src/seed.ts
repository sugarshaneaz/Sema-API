import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const niches = [
  {
    id: "restaurant_cafe",
    label: "Restaurant & Cafe",
    template: {
      systemRules: [
        "Never guess menu items, prices, or availability - always refer to the business catalog",
        "Use business facts first before making assumptions",
        "Always ask clarifying questions when order details are unclear",
        "End every response with a clear next action (confirm order, ask for details, etc.)",
        "Be warm and welcoming in tone"
      ],
      intakeQuestions: [
        "What are your operating hours?",
        "Do you offer delivery, pickup, or dine-in?",
        "What is your average delivery time?",
        "Do you have any dietary options (vegetarian, halal, etc.)?",
        "What payment methods do you accept?"
      ],
      qualificationFlows: [
        { trigger: ["menu", "what do you have", "what's available"], followUp: "I can share our menu! Are you looking for a specific category like appetizers, mains, or drinks?" },
        { trigger: ["order", "i want", "i'd like"], followUp: "Great! What would you like to order? Please specify the item name and quantity." },
        { trigger: ["delivery", "deliver"], followUp: "We offer delivery! Can I get your delivery address to check if you're in our zone?" }
      ],
      starterFaqs: [
        { q: "What are your hours?", a: "[Business hours from profile]" },
        { q: "Do you deliver?", a: "[Delivery info from profile]" },
        { q: "What payment methods do you accept?", a: "[Payment methods from policies]" }
      ],
      upsellRules: [
        { trigger: "main_course_ordered", suggestion: "Would you like to add a drink or dessert to your order?" },
        { trigger: "single_item", suggestion: "Our combo meals offer great value! Would you like to see our combos?" }
      ],
      safetyRules: {
        escalateTriggers: ["complaint", "refund", "wrong order", "food poisoning", "allergic reaction"],
        refuseTriggers: []
      }
    }
  },
  {
    id: "grocery_minimart",
    label: "Grocery & Minimart",
    template: {
      systemRules: [
        "Never guess product availability or prices",
        "Always confirm stock before promising items",
        "Ask for clarification on brand preferences when multiple options exist",
        "End responses with clear next steps"
      ],
      intakeQuestions: [
        "What are your store hours?",
        "What is your delivery radius?",
        "Do you offer same-day delivery?",
        "What is your minimum order for delivery?",
        "What categories do you specialize in?"
      ],
      qualificationFlows: [
        { trigger: ["price", "how much", "cost"], followUp: "I can check that for you! Which specific product are you asking about?" },
        { trigger: ["available", "in stock", "do you have"], followUp: "Let me check our inventory. What product are you looking for?" },
        { trigger: ["delivery", "deliver"], followUp: "We deliver! What's your location so I can confirm you're in our delivery area?" }
      ],
      starterFaqs: [
        { q: "What are your delivery hours?", a: "[From business profile]" },
        { q: "What's the minimum order?", a: "[From policies]" }
      ],
      upsellRules: [
        { trigger: "staples_ordered", suggestion: "Would you like to add any fresh produce or dairy to complete your order?" }
      ],
      safetyRules: {
        escalateTriggers: ["expired product", "complaint", "refund", "wrong item"],
        refuseTriggers: []
      }
    }
  },
  {
    id: "electronics_phone",
    label: "Electronics & Phone Shop",
    template: {
      systemRules: [
        "Never guess specifications, compatibility, or prices",
        "Always verify product details from catalog before responding",
        "Ask clarifying questions about device model/version for accessories",
        "Provide warranty information when discussing purchases",
        "End with clear next action"
      ],
      intakeQuestions: [
        "Do you offer repairs or just sales?",
        "What brands do you carry?",
        "Do you offer warranties on your products?",
        "What payment options do you have (including installments)?",
        "Do you offer trade-ins?"
      ],
      qualificationFlows: [
        { trigger: ["compatible", "work with", "fit"], followUp: "I can help check compatibility! What device model do you have?" },
        { trigger: ["repair", "fix", "broken"], followUp: "We can help with repairs! What device is it and what's the issue?" },
        { trigger: ["warranty", "guarantee"], followUp: "Let me check the warranty details for that product. Which item are you asking about?" }
      ],
      starterFaqs: [
        { q: "Do you offer warranties?", a: "[From warranty policy]" },
        { q: "Can I pay in installments?", a: "[From payment methods]" }
      ],
      upsellRules: [
        { trigger: "phone_purchase", suggestion: "Would you like a screen protector or case for your new phone?" },
        { trigger: "laptop_purchase", suggestion: "Would you like to add a laptop bag or mouse?" }
      ],
      safetyRules: {
        escalateTriggers: ["defective", "not working", "refund", "warranty claim", "complaint"],
        refuseTriggers: []
      }
    }
  },
  {
    id: "computers_accessories",
    label: "Computers & Accessories",
    template: {
      systemRules: [
        "Never guess technical specifications or compatibility",
        "Always verify specs from catalog before responding",
        "Ask about use case to recommend appropriate products",
        "Provide accurate stock and pricing information only",
        "End with clear next steps"
      ],
      intakeQuestions: [
        "Do you build custom PCs?",
        "What brands do you carry?",
        "Do you offer technical support after purchase?",
        "What warranty do you provide?",
        "Do you offer business/bulk pricing?"
      ],
      qualificationFlows: [
        { trigger: ["recommend", "suggest", "which one"], followUp: "I'd love to help! What will you primarily use it for (gaming, work, graphic design)?" },
        { trigger: ["compatible", "work with"], followUp: "Let me check compatibility. What's your current setup (motherboard, processor)?" },
        { trigger: ["upgrade", "improve"], followUp: "What are you looking to upgrade? RAM, storage, graphics card?" }
      ],
      starterFaqs: [
        { q: "Do you build custom PCs?", a: "[From business profile]" },
        { q: "What warranty do you offer?", a: "[From warranty policy]" }
      ],
      upsellRules: [
        { trigger: "pc_purchase", suggestion: "Would you like to add a monitor, keyboard, or mouse?" },
        { trigger: "storage_purchase", suggestion: "Would you like a backup drive as well?" }
      ],
      safetyRules: {
        escalateTriggers: ["defective", "dead on arrival", "refund", "complaint", "warranty claim"],
        refuseTriggers: []
      }
    }
  },
  {
    id: "hardware_building",
    label: "Hardware & Building Materials",
    template: {
      systemRules: [
        "Never guess dimensions, specifications, or load capacities",
        "Always verify product details and availability from catalog",
        "Ask about project requirements for accurate recommendations",
        "Provide delivery options for heavy/bulk items",
        "End with clear next action"
      ],
      intakeQuestions: [
        "Do you offer delivery for heavy items?",
        "Do you provide cutting/sizing services?",
        "What payment terms do you offer for large orders?",
        "Do you work with contractors (bulk pricing)?",
        "What areas do you deliver to?"
      ],
      qualificationFlows: [
        { trigger: ["how much do i need", "calculate", "quantity"], followUp: "I can help estimate! What are the dimensions of your project area?" },
        { trigger: ["delivery", "transport"], followUp: "We deliver heavy items! What's your location and approximately how much material do you need?" },
        { trigger: ["bulk", "large order", "contractor"], followUp: "We offer bulk pricing! What project are you working on?" }
      ],
      starterFaqs: [
        { q: "Do you deliver?", a: "[From delivery policy]" },
        { q: "Do you offer bulk discounts?", a: "[From business profile]" }
      ],
      upsellRules: [
        { trigger: "cement_ordered", suggestion: "Would you also need sand, ballast, or building stones?" },
        { trigger: "paint_ordered", suggestion: "Would you like brushes, rollers, or primer?" }
      ],
      safetyRules: {
        escalateTriggers: ["wrong delivery", "damaged goods", "complaint", "refund", "quality issue"],
        refuseTriggers: []
      }
    }
  },
  {
    id: "beauty_supply",
    label: "Beauty Supply Store",
    template: {
      systemRules: [
        "Never make claims about medical or therapeutic benefits",
        "Always verify product details from catalog",
        "Ask about skin/hair type for personalized recommendations",
        "Mention any allergen warnings when relevant",
        "End with clear next action"
      ],
      intakeQuestions: [
        "Do you sell retail only or also wholesale?",
        "What brands do you carry?",
        "Do you offer samples?",
        "What is your return policy for cosmetics?",
        "Do you have a loyalty program?"
      ],
      qualificationFlows: [
        { trigger: ["recommend", "suggest", "best for"], followUp: "I'd love to help! What's your skin/hair type and what result are you looking for?" },
        { trigger: ["sensitive", "allergy"], followUp: "We have gentle options! Do you have any specific ingredients you need to avoid?" },
        { trigger: ["wholesale", "bulk"], followUp: "We offer wholesale pricing! What products are you interested in and in what quantities?" }
      ],
      starterFaqs: [
        { q: "Can I return makeup?", a: "[From returns policy]" },
        { q: "Do you have organic products?", a: "[From catalog categories]" }
      ],
      upsellRules: [
        { trigger: "skincare_purchased", suggestion: "Would you like to add a sunscreen to protect your skin?" },
        { trigger: "haircare_purchased", suggestion: "Would you like a leave-in treatment to complete your routine?" }
      ],
      safetyRules: {
        escalateTriggers: ["allergic reaction", "skin reaction", "complaint", "refund"],
        refuseTriggers: ["diagnose", "cure", "treat disease"]
      }
    }
  },
  {
    id: "salon_services",
    label: "Salon & Beauty Services",
    template: {
      systemRules: [
        "Never guess availability - always check booking system",
        "Always confirm service details and pricing from catalog",
        "Ask about preferences and allergies before services",
        "Provide clear booking confirmation",
        "End with appointment details or next steps"
      ],
      intakeQuestions: [
        "What services do you offer?",
        "What are your operating hours?",
        "Do you require appointments or accept walk-ins?",
        "What is your cancellation policy?",
        "Do you offer packages or memberships?"
      ],
      qualificationFlows: [
        { trigger: ["book", "appointment", "schedule"], followUp: "I can help you book! What service are you interested in and when would you like to come in?" },
        { trigger: ["price", "cost", "how much"], followUp: "I can share our pricing! Which service would you like to know about?" },
        { trigger: ["available", "opening", "slot"], followUp: "Let me check availability! What day and time works best for you?" }
      ],
      starterFaqs: [
        { q: "What are your hours?", a: "[From business profile]" },
        { q: "Do I need an appointment?", a: "[From business profile]" }
      ],
      upsellRules: [
        { trigger: "haircut_booked", suggestion: "Would you like to add a deep conditioning treatment?" },
        { trigger: "manicure_booked", suggestion: "Would you like to upgrade to a gel manicure?" }
      ],
      safetyRules: {
        escalateTriggers: ["complaint", "injury", "allergic reaction", "refund", "damage"],
        refuseTriggers: []
      }
    }
  },
  {
    id: "clothing_shoes",
    label: "Clothing & Shoes",
    template: {
      systemRules: [
        "Never guess sizes or availability",
        "Always verify stock and sizes from catalog",
        "Ask about size and fit preferences",
        "Provide clear return/exchange policy info",
        "End with next action"
      ],
      intakeQuestions: [
        "Do you sell men's, women's, or both?",
        "What size range do you carry?",
        "Do you offer alterations?",
        "What is your return/exchange policy?",
        "Do you ship or only in-store?"
      ],
      qualificationFlows: [
        { trigger: ["size", "fit"], followUp: "I can help with sizing! What are your measurements or usual size?" },
        { trigger: ["available", "in stock"], followUp: "Let me check stock! What item and size are you looking for?" },
        { trigger: ["return", "exchange"], followUp: "We have a flexible policy! What item are you looking to return or exchange?" }
      ],
      starterFaqs: [
        { q: "Can I return items?", a: "[From returns policy]" },
        { q: "Do you have my size?", a: "I can check! What size are you looking for?" }
      ],
      upsellRules: [
        { trigger: "outfit_purchased", suggestion: "Would you like matching accessories or shoes?" },
        { trigger: "shoes_purchased", suggestion: "Would you like socks or shoe care products?" }
      ],
      safetyRules: {
        escalateTriggers: ["wrong size shipped", "defective", "complaint", "refund"],
        refuseTriggers: []
      }
    }
  },
  {
    id: "home_decor_furniture",
    label: "Home Decor & Furniture",
    template: {
      systemRules: [
        "Never guess dimensions, materials, or delivery times",
        "Always verify specs and stock from catalog",
        "Ask about room dimensions and style preferences",
        "Provide clear delivery and assembly information",
        "End with next steps"
      ],
      intakeQuestions: [
        "Do you offer delivery and assembly?",
        "What styles do you specialize in?",
        "Do you do custom orders?",
        "What are your delivery areas?",
        "What is your return policy for furniture?"
      ],
      qualificationFlows: [
        { trigger: ["fit", "dimensions", "size"], followUp: "I can help! What are the dimensions of the space you're furnishing?" },
        { trigger: ["delivery", "shipping"], followUp: "We offer delivery! Where are you located so I can provide timing and cost?" },
        { trigger: ["custom", "made to order"], followUp: "We can discuss custom options! What piece are you thinking about?" }
      ],
      starterFaqs: [
        { q: "Do you assemble?", a: "[From delivery policy]" },
        { q: "What's the delivery time?", a: "[From delivery policy]" }
      ],
      upsellRules: [
        { trigger: "sofa_purchased", suggestion: "Would you like matching throw pillows or a coffee table?" },
        { trigger: "bed_purchased", suggestion: "Would you like to add bedding or nightstands?" }
      ],
      safetyRules: {
        escalateTriggers: ["damaged", "wrong item", "complaint", "refund", "delayed delivery"],
        refuseTriggers: []
      }
    }
  },
  {
    id: "auto_parts",
    label: "Auto Parts & Accessories",
    template: {
      systemRules: [
        "Never guess compatibility - always verify with vehicle make/model/year",
        "Always confirm part numbers and specifications from catalog",
        "Ask for VIN or exact vehicle details when needed",
        "Provide warranty information for parts",
        "End with clear next action"
      ],
      intakeQuestions: [
        "Do you specialize in any vehicle makes?",
        "Do you offer installation services?",
        "What brands do you carry (OEM, aftermarket)?",
        "What is your warranty on parts?",
        "Do you deliver or only pickup?"
      ],
      qualificationFlows: [
        { trigger: ["fit", "compatible", "work with"], followUp: "I can check! What's your vehicle make, model, and year?" },
        { trigger: ["part number", "oem"], followUp: "Do you have the OEM part number? It helps me find the exact match." },
        { trigger: ["install", "fitting"], followUp: "We can help with installation! What part do you need installed?" }
      ],
      starterFaqs: [
        { q: "Do you install parts?", a: "[From business profile]" },
        { q: "What warranty do parts have?", a: "[From warranty policy]" }
      ],
      upsellRules: [
        { trigger: "brake_pads_ordered", suggestion: "Would you like brake fluid or rotors inspected as well?" },
        { trigger: "oil_filter_ordered", suggestion: "Would you like to add engine oil for a full service?" }
      ],
      safetyRules: {
        escalateTriggers: ["wrong part", "defective", "safety concern", "refund", "complaint"],
        refuseTriggers: []
      }
    }
  },
  {
    id: "pharmacy_guardrailed",
    label: "Pharmacy (Guardrailed)",
    template: {
      systemRules: [
        "NEVER provide medical diagnosis or advice",
        "NEVER suggest medications for conditions - only share what's available",
        "NEVER discuss drug interactions - refer to pharmacist",
        "NEVER provide dosage recommendations without prescription reference",
        "Always refer medical questions to in-store pharmacist",
        "Only provide product availability and pricing information",
        "End with clear next action"
      ],
      intakeQuestions: [
        "What are your pharmacy hours?",
        "Do you offer delivery for prescriptions?",
        "Do you accept insurance or NHIF?",
        "What OTC categories do you stock?",
        "Is there a pharmacist available for consultations?"
      ],
      qualificationFlows: [
        { trigger: ["do you have", "available", "in stock"], followUp: "I can check availability! What product are you looking for?" },
        { trigger: ["price", "cost", "how much"], followUp: "I can share pricing! Which product would you like to know about?" },
        { trigger: ["delivery", "deliver"], followUp: "We offer delivery for some items! What's your location?" }
      ],
      starterFaqs: [
        { q: "What are your hours?", a: "[From business profile]" },
        { q: "Do you deliver?", a: "[From delivery policy]" }
      ],
      upsellRules: [],
      safetyRules: {
        escalateTriggers: [
          "pregnant", "pregnancy", "breastfeeding",
          "child", "children", "baby", "infant", "pediatric",
          "severe", "emergency", "serious",
          "reaction", "side effect", "adverse",
          "overdose", "too much",
          "interact", "interaction", "mix with", "taking with"
        ],
        refuseTriggers: [
          "what should I take for",
          "recommend medicine for",
          "diagnose",
          "what's wrong with me",
          "is this safe for",
          "can I take this with",
          "dosage for",
          "how much should I take",
          "prescribe",
          "cure",
          "treat my"
        ],
        refusalMessage: "I'm not able to provide medical advice. Please speak with our pharmacist in-store or call us for guidance on medications and dosages.",
        escalationMessage: "This requires a pharmacist's expertise. Let me connect you with our pharmacist who can help safely."
      }
    }
  },
  {
    id: "general_retail",
    label: "General Retail",
    template: {
      systemRules: [
        "Never guess product details or availability",
        "Always verify from catalog before responding",
        "Ask clarifying questions when requests are vague",
        "Provide accurate pricing only",
        "End with clear next action"
      ],
      intakeQuestions: [
        "What are your store hours?",
        "What product categories do you sell?",
        "Do you offer delivery?",
        "What payment methods do you accept?",
        "What is your return policy?"
      ],
      qualificationFlows: [
        { trigger: ["price", "cost", "how much"], followUp: "I can check that! Which product are you asking about?" },
        { trigger: ["available", "in stock"], followUp: "Let me check! What product are you looking for?" },
        { trigger: ["delivery", "ship"], followUp: "We can deliver! Where are you located?" }
      ],
      starterFaqs: [
        { q: "What are your hours?", a: "[From business profile]" },
        { q: "Do you deliver?", a: "[From delivery policy]" }
      ],
      upsellRules: [
        { trigger: "purchase_made", suggestion: "Is there anything else I can help you find today?" }
      ],
      safetyRules: {
        escalateTriggers: ["complaint", "refund", "problem", "issue"],
        refuseTriggers: []
      }
    }
  }
];

async function seed() {
  console.log("Starting seed...");

  for (const niche of niches) {
    console.log(`Upserting niche: ${niche.id}`);

    await prisma.niche.upsert({
      where: { id: niche.id },
      update: {
        label: niche.label,
        isActive: true,
        version: { increment: 1 }
      },
      create: {
        id: niche.id,
        label: niche.label,
        isActive: true,
        version: 1
      }
    });

    await prisma.nicheTemplate.upsert({
      where: { nicheId: niche.id },
      update: {
        templateJson: niche.template
      },
      create: {
        nicheId: niche.id,
        templateJson: niche.template
      }
    });
  }

  console.log("Seed completed successfully!");
  console.log(`Seeded ${niches.length} niches with templates.`);
}

seed()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
