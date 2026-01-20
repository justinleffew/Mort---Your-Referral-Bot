import { Contact, ContactNote, RadarAngle, GeneratedMessage, MortgageQueryResponse, BrainDumpClient, GeneralAssistResponse } from "../types";

type OpenAiConfig = {
    apiKey: string;
};

const OPENAI_MODEL = 'gpt-4o-mini';

const getEnvApiKey = () => {
    return import.meta.env.VITE_OPENAI_SECRET_KEY
        ?? process.env.OPENAI_SECRET_KEY
        ?? process.env.VITE_OPENAI_SECRET_KEY;
};

export const getAi = (): OpenAiConfig | null => {
    const apiKey = getEnvApiKey();
    if (!apiKey) return null;
    return { apiKey };
};

const callOpenAiJson = async <T>(apiKey: string, prompt: string): Promise<T> => {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: OPENAI_MODEL,
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' }
        })
    });

    if (!response.ok) {
        throw new Error(`OpenAI request failed: ${response.status}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content ?? '{}';
    return JSON.parse(content) as T;
};

export const determineAngle = (contact: Contact, notes: ContactNote[], usedAngles: string[]): RadarAngle => {
    const hasInterests = contact.radar_interests.length > 0;
    const hasMortgageOpp = !!contact.mortgage_inference;
    const hasSaleDate = !!contact.sale_date;

    if (hasMortgageOpp && !usedAngles.includes('equity_opportunity')) return 'equity_opportunity';
    if (hasInterests && !usedAngles.includes('interest_based')) return 'interest_based';
    if (hasSaleDate && !usedAngles.includes('homeownership_milestone')) return 'homeownership_milestone';
    if (!usedAngles.includes('light_value_framing')) return 'light_value_framing';
    return 'friendly_checkin';
};

export const generateRadarMessage = async (
    contact: Contact,
    angle: RadarAngle,
    notes: ContactNote[]
): Promise<GeneratedMessage> => {
    const ai = getAi();
    const notesText = notes
        .slice(0, 5)
        .map(n => `${new Date(n.created_at).toLocaleDateString()}: ${n.note_text}`)
        .join(' | ');
    const interestsText = contact.radar_interests.join(', ');
    const mortgageContext = contact.mortgage_inference
        ? `Financial Inference: ${contact.mortgage_inference.opportunity_tag} due to ${contact.mortgage_inference.reasoning}`
        : '';

    const firstName = contact.full_name.split(' ')[0];
    const fallbacks: Record<RadarAngle, string> = {
        friendly_checkin: `Hi ${firstName}, crossed my mind today! Hope you're doing great. If you need anything house-wise, happy to help.`,
        interest_based: `Hi ${firstName}, saw something that made me think of your interest in ${contact.radar_interests[0] || 'your hobbies'}! Hope all is well.`,
        time_since_contact: `Hi ${firstName}, realized it's been a bit. Hope life is treating you well! Here if you need anything.`,
        homeownership_milestone: `Hi ${firstName}, hope the house is treating you well! Can't believe how time flies. Hope you're great.`,
        light_value_framing: `Hi ${firstName}, seeing some interesting shifts in the market lately and thought of you. Hope you're doing well!`,
        equity_opportunity: `Hi ${firstName}, was looking at some data for ${contact.location_context || 'your area'} and thought of you. Hope things are great!`
    };

    if (!ai) return { message: fallbacks[angle], reason: "Key missing", angle };

    try {
        const prompt = `
        You are an assistant for a solo real estate agent. Write a text message (SMS) to a past client.

        Client: ${contact.full_name}
        Interests: ${interestsText}
        Family: ${contact.family_details.children.join(', ')}
        Notes (recent first): ${notesText || 'None'}
        ${mortgageContext}
        Safe mode: ${contact.safe_mode ? 'on' : 'off'}
        Angle: ${angle}

        STRICT RULES:
        1. Plain text only. No emojis.
        2. Max 3 short sentences. Be casual.
        3. NO "I hope this finds you well".
        4. NO direct asks for referrals.
        5. Soft close: "Happy to help if you need anything."
        6. Reference their interests or inferred financial situation subtly.
        7. Avoid sensitive topics (health/medical, politics, religion, legal issues, tragedies, or personal finances).
        8. If safe mode is on, keep the message strictly neutral and avoid any potentially sensitive or personal assumptions.

        Output JSON: { "message": "string", "reason": "string explanation" }
        `;

        const json = await callOpenAiJson<{ message?: string; reason?: string }>(ai.apiKey, prompt);
        return {
            message: json.message || fallbacks[angle],
            reason: json.reason || "Generated from context",
            angle
        };
    } catch (e) {
        return { message: fallbacks[angle], reason: "Error", angle };
    }
};

export const processBrainDump = async (transcript: string): Promise<BrainDumpClient[]> => {
    const ai = getAi();
    if (!ai || !transcript.trim()) return [];

    const prompt = `
    You are "Mort," a backend data processing agent for a CRM app designed for Real Estate Agents.
    Ingest the following unstructured voice transcript about past clients and extract structured data.

    Input Transcript: "${transcript}"

    RULES:
    1. Identify Distinct Clients. Separate them.
    2. Extract names, locations, and approx year of transaction.
    3. Extract hobbies, sports teams, kids, pets.
    4. Infer Mortgage Opportunities:
       - 2020-2021: Assume Low Rate (<3.5%), High Equity. Tag: "HELOC / Cash-Out".
       - 2023-2024: Assume High Rate (>6.5%). Tag: "Refinance Watch".
       - 5+ Years Ago: Assume Move-up Buyer or Empty Nester.

    Output ONLY a JSON object: { "clients": [ ... ] }
    `;

    try {
        const data = await callOpenAiJson<{ clients?: BrainDumpClient[] }>(ai.apiKey, prompt);
        return data.clients || [];
    } catch (e) {
        console.error("Failed to parse brain dump", e);
        return [];
    }
};

export const generateBrainDumpFollowUps = async (transcript: string): Promise<string[]> => {
    const ai = getAi();
    if (!ai || !transcript.trim()) return [];

    const prompt = `
    You are Mort, a CRM assistant for real estate agents.
    Find vague or overly broad details in this voice transcript and ask short, specific follow-up questions.
    Examples of vague details: "sports", "music", "food", "travel", "business", "investing".
    Ask for specificity that would enable proactive outreach (teams, artists, cuisines, destinations, companies, etc.).
    If nothing is vague, return an empty array.

    Transcript: "${transcript}"

    Output JSON only: { "questions": ["..."] }
    `;

    try {
        const data = await callOpenAiJson<{ questions?: string[] }>(ai.apiKey, prompt);
        return data.questions?.map(question => String(question).trim()).filter(Boolean) || [];
    } catch (e) {
        console.error("Failed to generate brain dump follow-ups", e);
        return [];
    }
};

export const generateMortgageResponse = async (query: string): Promise<MortgageQueryResponse> => {
    const ai = getAi();
    if (!ai) return { buyer_script: "AI Key missing.", ballpark_numbers: "N/A", heads_up: "N/A", next_steps: "Check settings." };

    const prompt = `
    You are Mort, a conservative, calm mortgage assistant. Talk to the AGENT.
    Query: "${query}"
    Output JSON: buyer_script, ballpark_numbers, heads_up, next_steps.
    `;

    const json = await callOpenAiJson<MortgageQueryResponse>(ai.apiKey, prompt);
    return {
        buyer_script: json.buyer_script || '',
        ballpark_numbers: json.ballpark_numbers || '',
        heads_up: json.heads_up || '',
        next_steps: json.next_steps || ''
    };
};

const formatContactSummary = (contact: Contact) => {
    const details = [
        `Name: ${contact.full_name}`,
        contact.location_context ? `Location: ${contact.location_context}` : null,
        contact.segment ? `Segment: ${contact.segment}` : null,
        contact.tags?.length ? `Tags: ${contact.tags.join(', ')}` : null,
        contact.radar_interests.length ? `Interests: ${contact.radar_interests.join(', ')}` : null,
        contact.family_details.children.length ? `Children: ${contact.family_details.children.join(', ')}` : null,
        contact.family_details.pets.length ? `Pets: ${contact.family_details.pets.join(', ')}` : null,
        contact.sale_date ? `Sale date: ${contact.sale_date}` : null,
        contact.last_contacted_at ? `Last contacted: ${contact.last_contacted_at}` : null,
    ].filter(Boolean);
    return details.join(' | ');
};

export const generateGeneralAssistResponse = async (
    query: string,
    contacts: Contact[],
    personaLabel?: string
): Promise<GeneralAssistResponse> => {
    const ai = getAi();
    if (!ai) return { response: "AI Key missing." };

    const contactSummaries = contacts.slice(0, 30).map(formatContactSummary).join('\n');
    const prompt = `
    You are Mort, a helpful assistant for relationship-based referral management. The user persona is "${personaLabel || 'general user'}".
    Use the contact data to answer questions, generate outreach ideas, and surface follow-up opportunities.
    If a question is ambiguous, ask one short clarifying question.

    Contacts on file:\n${contactSummaries || 'No contacts available.'}

    User question: "${query}"
    Output JSON: { "response": "string" }
    `;

    const json = await callOpenAiJson<GeneralAssistResponse>(ai.apiKey, prompt);
    return {
        response: json.response || ''
    };
};
