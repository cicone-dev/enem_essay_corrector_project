// src/services/essay.service.js

import { PrismaClient } from '@prisma/client';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Usamos gemini-2.5-flash como o modelo mais rápido e econômico
const modelName = process.env.GEMINI_MODEL_NAME || 'gemini-2.5-flash';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const prisma = new PrismaClient();

// --- Funções Auxiliares ---

/**
 * Gera o prompt detalhado para o modelo Gemini.
 */
const generatePrompt = (essayText, essayTopic) => {
    // 🚨 CORREÇÃO CRÍTICA NO PROMPT: Instrução de formato ultra-rígida
    return `
    Você é um corretor HUMANO de redações de alta performance, especializado na correção de redações do ENEM por anos.
    Sua tarefa é avaliar a redação de acordo com as cinco competências do ENEM (C1 a C5) e fornecer uma análise textual completa.
    
    A nota de cada competência deve ser um múltiplo de 40 (0, 40, 80, 120, 160, 200). A nota TOTAL deve ser a soma das 5 notas.

    O TEMA da redação é: "${essayTopic}".
    A REDAÇÃO submetida é:
    ---
    ${essayText}
    ---
    
    // ** ESTA É A INSTRUÇÃO CRÍTICA **
    Sua resposta DEVE ser EXCLUSIVAMENTE o objeto JSON solicitado abaixo. 
    NÃO adicione preâmbulos, explicações, texto introdutório, nem blocos de código Markdown (\`\`\`) ou texto de encerramento.
    A PRIMEIRA E ÚLTIMA coisa na sua resposta deve ser, respectivamente, o { e o }. O formato JSON é:
    {
      "competencias": {
        "c1": { "nota": number, "comentario": string },
        "c2": { "nota": number, "comentario": string },
        "c3": { "nota": number, "comentario": string },
        "c4": { "nota": number, "comentario": string },
        "c5": { "nota": number, "comentario": string }
      },
      "total": number,
      "feedbackGeral": string,
      "pontosPositivos": string,
      "pontosA_Melhorar": string,
      "analiseTextual": {
        "coesaoEConectores": string,
        "vocabulario": string,
        "ortografia": string,
        "repertorioSociocultural": string
      },
      "sugestoesDeMelhora": string
    }
    `;
};

/**
 * Corrige o JSON de saída e previne erros.
 */
const parseJsonSafely = (jsonString) => {
    if (!jsonString || typeof jsonString !== 'string') {
        return null;
    }
    
    let cleanString = jsonString.trim();

    // Remove blocos de código Markdown (```json...``` ou ```...```)
    if (cleanString.startsWith("```")) {
        // Usa uma regex mais abrangente para garantir a remoção
        cleanString = cleanString.replace(/^```(json)?\s*|```$/g, '').trim();
    }

    try {
        return JSON.parse(cleanString);
    } catch (e) {
        // Se a primeira tentativa de parse falhar, tenta limpar linhas em branco extras
        try {
            const strippedString = cleanString.replace(/\r?\n|\r/g, '').trim();
            return JSON.parse(strippedString);
        } catch (e2) {
            console.error("🚨 Erro ao parsear JSON da correção após limpeza:", e2.message);
            return null;
        }
    }
};


// --- Funções de Serviço ---

/**
 * Processa a submissão e correção de uma nova redação.
 */
export const submitEssay = async (userId, essayData) => { 
    try {
        // 🚨 Mapeamento de chaves corrigido para o frontend (text, topic)
        const { topic: essayTopic, text: essayText } = essayData; 
        
        if (!essayTopic || !essayText || essayTopic.trim() === '' || essayText.trim() === '') {
             throw new Error("Tópico ou texto da redação está faltando na submissão.");
        }
        
        // 1. Cria a redação no banco de dados
        const newEssay = await prisma.essay.create({
            data: {
                userId,
                topic: essayTopic,
                text: essayText,
            },
        });

        // 2. Gera o prompt para o modelo
        const prompt = generatePrompt(essayText, essayTopic);

        // 3. Chamada à API do Gemini
        const model = genAI.getGenerativeModel({ model: modelName });

        // 🚨 Sintaxe de DOIS ARGUMENTOS (mais estável contra bugs de SDK)
        const correctionResponse = await model.generateContent(
            // 1º ARGUMENTO: CONTENTS (Sintaxe de chat)
            [{ role: "user", parts: [{ text: prompt }] }],
            
            // 2º ARGUMENTO: CONFIG (Schema)
            {
                responseMimeType: "application/json",
                // Schema mantido conforme suas especificações
                responseSchema: {
                    type: "OBJECT",
                    properties: {
                        competencias: { type: "OBJECT" }, total: { type: "NUMBER" },
                        feedbackGeral: { type: "STRING" }, pontosPositivos: { type: "STRING" },
                        pontosA_Melhorar: { type: "STRING" }, 
                        analiseTextual: { 
                            type: "OBJECT",
                            properties: {
                                coesaoEConectores: { type: "STRING" },
                                vocabulario: { type: "STRING" },
                                ortografia: { type: "STRING" },
                                repertorioSociocultural: { type: "STRING" }
                            }
                        },
                        sugestoesDeMelhora: { type: "STRING" }
                    }
                }
            }
        );

        // 4. Processamento da Resposta
        const rawJson = correctionResponse.text;
        const correctionData = parseJsonSafely(rawJson);

        // 🚨 Esta linha quebra se o JSON for inválido, mas o parseJsonSafely deve ser mais robusto agora.
        if (!correctionData || !correctionData.competencias || correctionData.total === undefined) {
            // Se ainda falhar, é um problema de consistência da resposta do modelo
            throw new Error(`A IA retornou um formato de correção inválido. Raw Output: ${rawJson.substring(0, 200)}...`);
        }
        
        // 5. Cria a correção no banco de dados
        const correction = await prisma.correction.create({
            data: {
                essayId: newEssay.id,
                notes: correctionData,
                total: correctionData.total || 0,
            },
        });
        
        // 6. Retorna o resultado
        return {
            ...newEssay,
            latestCorrection: correctionData,
            correctionId: correction.id,
        };

    } catch (error) {
        // Se o erro for do Gemini (formato, etc.), a mensagem detalhada é propagada.
        console.error("🚨 Erro final no submitEssay:", error.name, error.message);
        throw new Error(`Falha ao submeter a redação: ${error.message}`);
    }
};

// ... (Restante das funções getEssayById, getEssayHistory, etc.)
/**
 * Busca uma redação específica por ID.
 */
export const getEssayById = async (essayId, userId) => {
    // 🚨 FIX PRISMA: Adiciona validação de ID para evitar Malformed ObjectID
    if (!essayId || typeof essayId !== 'string' || essayId.length !== 24 || !/^[0-9a-fA-F]{24}$/.test(essayId)) {
        throw new Error("ID de redação inválido ou incompleto.");
    }
    
    try {
        const essay = await prisma.essay.findUnique({
            where: { id: essayId, userId: userId },
            include: {
                corrections: { orderBy: { createdAt: 'desc' }, take: 1 }
            }
        });

        if (!essay) { throw new Error("Redação não encontrada ou acesso negado."); }

        if (essay.corrections && essay.corrections.length > 0) {
            const latestCorrection = essay.corrections[0];
            // O campo notes é Json, precisa ser desserializado (se não for feito automaticamente pelo Prisma)
            // Usamos parseJsonSafely para garantir compatibilidade com o formato JSON da correção
            essay.latestCorrection = parseJsonSafely(JSON.stringify(latestCorrection.notes)); 
        } else {
            essay.latestCorrection = null;
        }
        return essay;
    } catch (error) {
        console.error("Erro ao buscar redação por ID:", error.message);
        throw error;
    }
};


export const getEssayHistory = async (userId) => {
    try {
        const essays = await prisma.essay.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            include: { corrections: { orderBy: { createdAt: 'desc' }, take: 1 } }
        });

        return essays.map(essay => {
            const correction = essay.corrections[0];
            const parsedContent = correction ? parseJsonSafely(JSON.stringify(correction.notes)) : null;

            return {
                id: essay.id,
                topic: essay.topic,
                createdAt: essay.createdAt,
                // Usa a nota total salva no campo 'total'
                total: correction?.total || 0, 
                correction: parsedContent
            };
        }).filter(essay => essay.correction !== null);
    } catch (error) {
        console.error("Erro ao buscar histórico de redações:", error.message);
        throw new Error("Não foi possível carregar o histórico.");
    }
};

/**
 * Calcula as métricas de Analytics. (Mantém a lógica robusta)
 */
export const getEssayAnalytics = async (userId) => {
    try {
        const allEssays = await prisma.essay.findMany({
            where: { userId }, orderBy: { createdAt: 'asc' },
            include: { corrections: { orderBy: { createdAt: 'desc' }, take: 1 } }
        });

        const gradedEssays = allEssays
            .filter(essay => essay.corrections.length > 0)
            .map(essay => {
                const parsedContent = parseJsonSafely(JSON.stringify(essay.corrections[0].notes));
                return { 
                    ...essay, 
                    latestCorrection: parsedContent,
                    // Usa a nota total do DB
                    total: essay.corrections[0].total || 0 
                };
            })
            .filter(essay => essay.latestCorrection !== null);

        const totalEssays = gradedEssays.length;

        if (totalEssays === 0) {
            return { totalEssays: 0, averageScore: 0, scoreHistory: [], competenceAverages: [], latestEssays: [], totalWords: 0 };
        }

        const totalScoreSum = gradedEssays.reduce((sum, essay) => sum + (essay.total || 0), 0);
        const averageScore = Math.round(totalScoreSum / totalEssays) || 0;

        const scoreHistory = gradedEssays.map(essay => ({
            date: new Date(essay.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }),
            total: essay.total || 0,
        }));

        const competenceSum = gradedEssays.reduce((acc, essay) => {
            const comps = essay.latestCorrection?.competencias;
            if (comps) {
                acc.c1 += comps.c1?.nota || 0; acc.c2 += comps.c2?.nota || 0; acc.c3 += comps.c3?.nota || 0;
                acc.c4 += comps.c4?.nota || 0; acc.c5 += comps.c5?.nota || 0;
            }
            return acc;
        }, { c1: 0, c2: 0, c3: 0, c4: 0, c5: 0 });

        const competenceAverages = [
            { subject: 'C1', A: Math.round(competenceSum.c1 / totalEssays) || 0, fullMark: 200 },
            { subject: 'C2', A: Math.round(competenceSum.c2 / totalEssays) || 0, fullMark: 200 },
            { subject: 'C3', A: Math.round(competenceSum.c3 / totalEssays) || 0, fullMark: 200 },
            { subject: 'C4', A: Math.round(competenceSum.c4 / totalEssays) || 0, fullMark: 200 },
            { subject: 'C5', A: Math.round(competenceSum.c5 / totalEssays) || 0, fullMark: 200 },
        ];

        const latestEssays = gradedEssays.slice(-3).reverse().map(essay => ({
            id: essay.id, topic: essay.topic, total: essay.total || 0, createdAt: essay.createdAt
        }));

        const totalWords = gradedEssays.reduce((sum, essay) => sum + (essay.text?.split(/\s+/).length || 0), 0);

        return { totalEssays, averageScore, scoreHistory, competenceAverages, latestEssays, totalWords };

    } catch (error) {
        console.error("Erro ao calcular analytics:", error.message);
        throw new Error("Não foi possível gerar as análises do dashboard.");
    }
};

/**
 * Busca as conquistas e verifica o status de desbloqueio. (Mantém a lógica robusta)
 */
export const getUserAchievements = async (userId) => {
    try {
        const essays = await prisma.essay.findMany({
            where: { userId },
            include: { corrections: { orderBy: { createdAt: 'desc' }, take: 1 } }
        });

        const gradedEssays = essays.filter(e => e.corrections.length > 0);

        const essayGrades = gradedEssays
            .map(e => e.corrections[0].total)
            .filter(score => score != null);

        const achievements = [
            { id: 'first_essay', title: 'Primeiro Passo', description: 'Submeta sua primeira redação.', unlocked: essayGrades.length >= 1 },
            { id: 'five_essays', title: 'Cinco na Conta', description: 'Submeta 5 redações.', unlocked: essayGrades.length >= 5 },
            { id: 'road_to_1000', title: 'Quase Perfeito', description: 'Alcance uma nota de 900+.', unlocked: essayGrades.some(grade => grade >= 900) },
        ];
        
        // Lógica de C5: usa o JSON parseado para buscar a nota da competência
        const c5Scores = gradedEssays
            .map(e => parseJsonSafely(JSON.stringify(e.corrections[0].notes))?.competencias?.c5?.nota)
            .filter(score => score != null);

        if (c5Scores.some(score => score === 200)) {
            const achievement = achievements.find(a => a.id === 'master_c5');
            if (achievement) achievement.unlocked = true;
        }

        return achievements;
    } catch (error) {
        console.error("Erro ao buscar conquistas:", error.message);
        throw new Error("Não foi possível buscar as conquistas.");
    }
};