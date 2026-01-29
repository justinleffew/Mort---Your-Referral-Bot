import { Contact, ContactNote, RadarAngle, GeneratedMessage, MortgageQueryResponse, BrainDumpClient, GeneralAssistResponse } from "../types";
import { getSupabaseClient } from "./supabaseClient";
import { invokeEdgeFunction } from "./edgeFunctions";
import { searchNewsEvents } from "./newsService";

type EdgeFunctionResponse<T> = {
    data?: T;
};

export const AUTH_REQUIRED_MESSAGE = 'Please sign in to use Mort AI.';

const callOpenAiJson = async <T>(prompt: string): Promise<T> => {
    const supabase = getSupabaseClient();
    if (!supabase) {
        throw new Error('Supabase is not configured.');
    }

    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
        throw new Error('Unable to check authentication status.');
    }
    if (!sessionData?.session) {
        throw new Error(AUTH_REQUIRED_MESSAGE);
    }

    const payload = await invokeEdgeFunction<EdgeFunctionResponse<T>, { prompt: string }>({
        functionName: 'mort-openai',
        body: { prompt },
    });
    if (!payload?.data) {
        throw new Error('Invalid AI response.');
    }

    return payload.data;
};

export type OpenAiTtsResponse = {
    audio: string;
    mimeType: string;
};

export const generateSpeechAudio = async (text: string, voice: string): Promise<OpenAiTtsResponse> => {
    const trimmed = text.trim();
    if (!trimmed) {
        throw new Error('Text is required for speech synthesis.');
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
        throw new Error('Supabase is not configured.');
    }

    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
        throw new Error('Unable to check authentication status.');
    }
    if (!sessionData?.session) {
        throw new Error(AUTH_REQUIRED_MESSAGE);
    }

    const payload = await invokeEdgeFunction<EdgeFunctionResponse<OpenAiTtsResponse>, { text: string; voice: string }>({
        functionName: 'mort-openai-tts',
        body: {
            text: trimmed,
            voice
        },
    });
    if (!payload?.data?.audio) {
        throw new Error('Invalid speech response.');
    }

    return payload.data;
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
    const notesText = notes
        .slice(0, 5)
        .map(n => `${new Date(n.created_at).toLocaleDateString()}: ${n.body}`)
        .join(' | ');
    const interestsText = contact.radar_interests.join(', ');
    const mortgageContext = contact.mortgage_inference
        ? `Financial Inference: ${contact.mortgage_inference.opportunity_tag} due to ${contact.mortgage_inference.reasoning}`
        : '';
    let eventContext = '';
    if (angle === 'interest_based' && contact.radar_interests.length > 0) {
        const events = await searchNewsEvents({
            interest: contact.radar_interests[0],
            location: contact.location_context,
            limit: 3,
        });
        const topEvent = events[0];
        if (topEvent) {
            const eventDate = new Date(topEvent.published_at).toLocaleDateString();
            eventContext = `Recent event match: ${topEvent.title} (${topEvent.source}, ${eventDate}). ${topEvent.relevance} Link: ${topEvent.url}`;
        }
    }

    const firstName = contact.full_name.split(' ')[0];
    const fallbacks: Record<RadarAngle, string> = {
        friendly_checkin: `Hi ${firstName}, crossed my mind today! Hope you're doing great. If you need anything house-wise, happy to help.`,
        interest_based: `Hi ${firstName}, saw something that made me think of your interest in ${contact.radar_interests[0] || 'your hobbies'}! Hope all is well.`,
        time_since_contact: `Hi ${firstName}, realized it's been a bit. Hope life is treating you well! Here if you need anything.`,
        homeownership_milestone: `Hi ${firstName}, hope the house is treating you well! Can't believe how time flies. Hope you're great.`,
        light_value_framing: `Hi ${firstName}, seeing some interesting shifts in the market lately and thought of you. Hope you're doing well!`,
        equity_opportunity: `Hi ${firstName}, was looking at some data for ${contact.location_context || 'your area'} and thought of you. Hope things are great!`
    };
    const reasonFallbacks: Record<RadarAngle, string> = {
        friendly_checkin: 'No new triggers surfaced, so a friendly check-in keeps the relationship warm.',
        interest_based: 'A recent interest match makes this a natural, personal moment to reach out.',
        time_since_contact: 'It has been a while since the last touch, so a quick hello feels timely.',
        homeownership_milestone: 'A homeownership milestone is a natural excuse to check in.',
        light_value_framing: 'A light market pulse gives you a simple, low-pressure reason to reach out.',
        equity_opportunity: 'Equity trends suggest a helpful check-in could be relevant right now.',
    };

    try {
        const prompt = `
        You are an assistant for a solo real estate agent. Write a text message (SMS) to a past client.

        Client: ${contact.full_name}
        Interests: ${interestsText}
        Family: ${contact.family_details.children.join(', ')}
        Notes (recent first): ${notesText || 'None'}
        ${eventContext}
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

        const json = await callOpenAiJson<{ message?: string; reason?: string }>(prompt);
        const message = json.message?.trim() || fallbacks[angle];
        const reason = json.reason?.trim() || reasonFallbacks[angle];
        return {
            message,
            reason,
            angle
        };
    } catch (e) {
        if (e instanceof Error && e.message === AUTH_REQUIRED_MESSAGE) {
            return { message: e.message, reason: reasonFallbacks[angle], angle };
        }
        return { message: fallbacks[angle], reason: reasonFallbacks[angle], angle };
    }
};

export const processBrainDump = async (transcript: string): Promise<BrainDumpClient[]> => {
    if (!transcript.trim()) return [];

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
    5. Assign matching tags from the lists below. Only use tags that apply, otherwise return an empty array.

    PRIMARY TAGS: Past Client, Friend, Family, Good Referral Source, Investor, Other
    SECONDARY TAGS: Professional Partner, Neighbor, Sphere of Influence, Community Worker, Local Business Owner, High Trust, Low Trust, Bad Experience, Influencer/Connector, Luxury/HNW, Fitness/Health Focused, Sports Connection, Faith-Oriented, Prefers Texting, Loves to talk, Detail-oriented, Decisive, Needs Reassurance, High Energy

    Each client object must include a tags array.
    Output ONLY a JSON object: { "clients": [ ... ] }
    `;

    try {
        const data = await callOpenAiJson<{ clients?: BrainDumpClient[] }>(prompt);
        return data.clients || [];
    } catch (e) {
        if (e instanceof Error && e.message === AUTH_REQUIRED_MESSAGE) {
            console.warn(e.message);
            return [];
        }
        console.error("Failed to parse brain dump", e);
        return [];
    }
};

const buildBrainDumpFollowUpFallback = (transcript: string) => {
    const lastNameMatch = transcript.match(/\b(?:his|her|their)?\s*(?:last name|surname)\s+(?:is|was)\s+([A-Z][a-z]+)\b/i);
    const lastName = lastNameMatch?.[1]?.trim() ?? '';
    const nameMatch = transcript.match(/\b(?:name|named)\s+(?:(?:is|was)\s+)?([A-Z][a-z]+)\b/i);
    const possibleName = nameMatch?.[1] || '';
    const name = ['is', 'was'].includes(possibleName.toLowerCase()) ? '' : possibleName.trim();
    const sportMatch = transcript.match(/\b(football|soccer|basketball|baseball|hockey|tennis|golf)\b/i);
    const sport = sportMatch ? sportMatch[1].toLowerCase() : '';
    const hasName = !!name;
    const hasLastName = !!lastName;
    const hasSport = !!sport;

    if (hasLastName) {
        if (!hasName && hasSport) {
            return {
                response: `Got it — sounds like ${sport} is a real interest here. What’s their first name, and do they have a favorite ${sport} team?`,
                questions: [
                    "What is their first name?",
                    `Do they have a favorite ${sport} team?`
                ]
            };
        }

        if (!hasName) {
            return {
                response: "Got it — who are we talking about? What’s their first name, and is there a specific interest or milestone to remember?",
                questions: [
                    "What is their first name?",
                    "Any specific interests, teams, or milestones to note?"
                ]
            };
        }

        if (hasSport) {
            return {
                response: `Got it — do they have a favorite ${sport} team?`,
                questions: [
                    `Do they have a favorite ${sport} team?`
                ]
            };
        }

        return {
            response: "Got it — any favorite interests or milestones to remember?",
            questions: [
                "Any favorite interests, teams, or milestones to note?"
            ]
        };
    }

    if (hasName && hasSport) {
        return {
            response: `Got it — love the ${sport} detail. What’s ${name}'s last name, and do they have a favorite ${sport} team?`,
            questions: [
                `What is ${name}'s last name?`,
                `Do they have a favorite ${sport} team?`
            ]
        };
    }

    if (hasName) {
        return {
            response: `Got it — what’s ${name}'s last name, and is there a specific interest or milestone to remember?`,
            questions: [
                `What is ${name}'s last name?`,
                "Any favorite interests, teams, or milestones to note?"
            ]
        };
    }

    return {
        response: "Got it — sounds like a past client. What’s their full name, and one specific interest or milestone you want to remember?",
        questions: [
            "What is their full name?",
            "Any specific interests, teams, or milestones to remember?"
        ]
    };
};

export const generateBrainDumpFollowUps = async (transcript: string): Promise<{ response: string; questions: string[] }> => {
    if (!transcript.trim()) return { response: '', questions: [] };

    const prompt = `
    You are Mort, a CRM assistant for real estate agents.
    Respond conversationally like a helpful assistant who just listened.
    First: acknowledge what was said and infer intent naturally.
    Then: ask only the missing detail(s) needed next, in a warm, human tone.
    Avoid robotic forms, lists, or marketing language.
    If nothing is vague or missing, return an empty questions array but still provide the response sentence.

    Transcript: "${transcript}"

    Output JSON only: { "response": "string", "questions": ["..."] }
    `;

    try {
        const data = await callOpenAiJson<{ response?: string; questions?: string[] }>(prompt);
        const questions = data.questions?.map(question => String(question).trim()).filter(Boolean) || [];
        return {
            response: data.response?.trim() || buildBrainDumpFollowUpFallback(transcript).response,
            questions
        };
    } catch (e) {
        if (e instanceof Error && e.message === AUTH_REQUIRED_MESSAGE) {
            return { response: e.message, questions: [] };
        }
        console.error("Failed to generate brain dump follow-ups", e);
        return buildBrainDumpFollowUpFallback(transcript);
    }
};

export const generateMortgageResponse = async (query: string): Promise<MortgageQueryResponse> => {
    const prompt = `
    You are Mort, a conservative, calm mortgage assistant. Talk to the AGENT.
    Query: "${query}"
    Output JSON: buyer_script, ballpark_numbers, heads_up, next_steps.
    `;

    try {
        const json = await callOpenAiJson<MortgageQueryResponse>(prompt);
        return {
            buyer_script: json.buyer_script || '',
            ballpark_numbers: json.ballpark_numbers || '',
            heads_up: json.heads_up || '',
            next_steps: json.next_steps || ''
        };
    } catch (e) {
        if (e instanceof Error && e.message === AUTH_REQUIRED_MESSAGE) {
            return { buyer_script: e.message, ballpark_numbers: '', heads_up: '', next_steps: '' };
        }
        console.error("Failed to generate mortgage response", e);
        return { buyer_script: "AI unavailable.", ballpark_numbers: "N/A", heads_up: "N/A", next_steps: "Check settings." };
    }
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
    const contactSummaries = contacts.slice(0, 30).map(formatContactSummary).join('\n');
    const prompt = `
    You are Mort, a helpful assistant for relationship-based referral management. The user persona is "${personaLabel || 'general user'}".
    Use the contact data to answer questions, generate outreach ideas, and surface follow-up opportunities.
    If a question is ambiguous, ask one short clarifying question.

    Contacts on file:\n${contactSummaries || 'No contacts available.'}

    User question: "${query}"
    Output JSON: { "response": "string" }
    `;

    try {
        const json = await callOpenAiJson<GeneralAssistResponse>(prompt);
        return {
            response: json.response || ''
        };
    } catch (e) {
        if (e instanceof Error && e.message === AUTH_REQUIRED_MESSAGE) {
            return { response: e.message };
        }
        console.error("Failed to generate general assist response", e);
        return { response: "AI unavailable." };
    }
};
