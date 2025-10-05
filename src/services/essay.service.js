import { PrismaClient } from '@prisma/client';
import { GoogleGenerativeAI } from '@google/generative-ai';

// 🚨 Obtém o nome do modelo da variável de ambiente (ou usa um fallback)
const modelName = process.env.GEMINI_MODEL_NAME || 'gemini-2.5-flash';

// Inicializa o cliente Gemini e Prisma
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const prisma = new PrismaClient();

// --- Funções Auxiliares ---

/**
 * Gera o prompt detalhado para o modelo Gemini.
 */
const generatePrompt = (essayText, essayTopic) => {
    return `
    Você é um corretor HUMANO de redações de alta performance, especializado na correção de redações do ENEM por anos.
    Sua tarefa é avaliar a redação de acordo com as cinco competências do ENEM (C1 a C5) e fornecer uma análise textual completa.
    
    A nota de cada competência deve ser um múltiplo de 40 (0, 40, 80, 120, 160, 200). A nota TOTAL deve ser a soma das 5 notas.
    
    O TEMA da redação é: "${essayTopic}".
    A REDAÇÃO submetida é:
    ---
    ${essayText}
    ---
    
    Sua resposta DEVE ser estruturada EXCLUSIVAMENTE em JSON e seguir este formato:
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
        "coesaoEConexao": string,
        "vocabulario": string,
        "gramaticaEOrtografia": string
      },
      "sugestoesDeMelhora": string
    }
    `;
};

/**
 * 🌟 CORREÇÃO CRÍTICA: Tenta fazer o parse de uma string JSON, limpando a resposta do modelo.
 * Isso resolve o crash 500 causado por formatação Markdown (` ```json `) na resposta da IA.
 * @param {string} jsonString - A string JSON a ser parseada.
 * @returns {object|null} O objeto parseado ou null em caso de erro.
 */
const parseJsonSafely = (jsonString) => {
    let cleanString = jsonString.trim();

    // Remove blocos de código Markdown (```json...``` ou ```...```)
    if (cleanString.startsWith("```")) {
        // Regex para remover as cercas de código (``` e ```json)
        cleanString = cleanString.replace(/^```(json)?\s*|```$/g, '').trim();
    }

    try {
        return JSON.parse(cleanString);
    } catch (e) {
        console.error("🚨 Erro ao parsear JSON da correção:", e.message);
        // Loga a string que falhou para debug
        console.error("String JSON que falhou (início):", cleanString.substring(0, 500) + '...');
        return null;
    }
};


// --- Funções de Serviço ---

/**
 * Processa a submissão e correção de uma nova redação.
 * 🌟 CORREÇÃO DE ARGUMENTOS: Garante que os argumentos estejam na ordem correta.
 */
export const submitEssay = async (userId, essayTopic, essayText) => {
    try {
        // 1. Cria a redação no banco de dados
        // 🌟 CORREÇÃO DE CAMPO: Usando 'text' no lugar de 'content' para alinhar com o erro 
        const newEssay = await prisma.essay.create({
            data: {
                userId,
                topic: essayTopic, // Nome do campo 'topic'
                text: essayText,   // Nome do campo 'text' (corpo da redação)
            },
        });

        // 2. Gera o prompt para o modelo
        const prompt = generatePrompt(essayText, essayTopic);

        // 3. Chamada à API do Gemini
        const response = await genAI.getGenerativeModel({ model: modelName }).generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            config: {
                responseMimeType: "application/json",
                // Manter o schema ajuda o modelo a ser consistente
                responseSchema: {
                    type: "OBJECT",
                    properties: {
                        competencias: { type: "OBJECT" }, total: { type: "NUMBER" },
                        feedbackGeral: { type: "STRING" }, pontosPositivos: { type: "STRING" },
                        pontosA_Melhorar: { type: "STRING" }, analiseTextual: { type: "OBJECT" },
                        sugestoesDeMelhora: { type: "STRING" }
                    }
                }
            }
        });

        // O conteúdo do JSON vem como uma string no campo 'text'
        const rawJson = response.text;
        const correctionData = parseJsonSafely(rawJson);

        if (!correctionData) {
            // Se o JSON for inválido após a limpeza, lança um erro para o controller
            throw new Error("A IA retornou um formato de correção inválido (JSON não pôde ser lido).");
        }

        // 4. Cria a correção no banco de dados (usando a lógica original de salvar o JSON como string)
        const correction = await prisma.correction.create({
            data: {
                essayId: newEssay.id,
                content: JSON.stringify(correctionData),
            },
        });
        
        // 5. Retorna a redação com o conteúdo da correção para o frontend
        return {
            ...newEssay,
            latestCorrection: correctionData,
            correctionId: correction.id,
        };

    } catch (error) {
        console.error("🚨 Erro final no submitEssay:", error.message);
        // Lança um erro mais amigável para o frontend
        throw new Error(`Falha ao submeter a redação: ${error.message}`);
    }
};

// --- Funções de Leitura (Sem Alteração na Lógica de Leitura) ---

/**
 * Busca uma redação específica por ID.
 */
export const getEssayById = async (essayId, userId) => {
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
            essay.latestCorrection = parseJsonSafely(latestCorrection.content);
        } else {
            essay.latestCorrection = null;
        }
        return essay;
    } catch (error) {
        console.error("Erro ao buscar redação por ID:", error.message);
        throw error;
    }
};

/**
 * Busca o histórico simples de redações.
 */
export const getEssayHistory = async (userId) => {
    try {
        const essays = await prisma.essay.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            include: { corrections: { orderBy: { createdAt: 'desc' }, take: 1 } }
        });

        return essays.map(essay => {
            const correction = essay.corrections[0];
            const parsedContent = correction ? parseJsonSafely(correction.content) : null;

            return {
                id: essay.id,
                topic: essay.topic,
                createdAt: essay.createdAt,
                correction: parsedContent
            };
        }).filter(essay => essay.correction !== null);
    } catch (error) {
        console.error("Erro ao buscar histórico de redações:", error.message);
        throw new Error("Não foi possível carregar o histórico.");
    }
};

/**
 * Calcula as métricas de Analytics.
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
                const parsedContent = parseJsonSafely(essay.corrections[0].content);
                return { ...essay, latestCorrection: parsedContent };
            })
            .filter(essay => essay.latestCorrection !== null);

        const totalEssays = gradedEssays.length;

        if (totalEssays === 0) {
            return { totalEssays: 0, averageScore: 0, scoreHistory: [], competenceAverages: [], latestEssays: [], totalWords: 0 };
        }

        const totalScoreSum = gradedEssays.reduce((sum, essay) => sum + (essay.latestCorrection?.total || 0), 0);
        const averageScore = Math.round(totalScoreSum / totalEssays) || 0;

        const scoreHistory = gradedEssays.map(essay => ({
            date: new Date(essay.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }),
            total: essay.latestCorrection.total || 0,
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
            id: essay.id, topic: essay.topic, total: essay.latestCorrection.total || 0, createdAt: essay.createdAt
        }));

        const totalWords = gradedEssays.reduce((sum, essay) => sum + (essay.text?.split(/\s+/).length || 0), 0);


        return { totalEssays, averageScore, scoreHistory, competenceAverages, latestEssays, totalWords };

    } catch (error) {
        console.error("Erro ao calcular analytics:", error.message);
        throw new Error("Não foi possível gerar as análises do dashboard.");
    }
};

/**
 * Busca as conquistas e verifica o status de desbloqueio.
 */
export const getUserAchievements = async (userId) => {
    try {
        const essays = await prisma.essay.findMany({
            where: { userId },
            include: { corrections: { orderBy: { createdAt: 'desc' }, take: 1 } }
        });

        const gradedEssays = essays.filter(e => e.corrections.length > 0);

        const essayGrades = gradedEssays
            .map(e => parseJsonSafely(e.corrections[0].content)?.total)
            .filter(score => score != null);

        const achievements = [
            { id: 'first_essay', title: 'Primeiro Passo', description: 'Submeta sua primeira redação.', unlocked: essayGrades.length >= 1 },
            { id: 'five_essays', title: 'Cinco na Conta', description: 'Submeta 5 redações.', unlocked: essayGrades.length >= 5 },
            { id: 'road_to_1000', title: 'Quase Perfeito', description: 'Alcance uma nota de 900+.', unlocked: essayGrades.some(grade => grade >= 900) },
        ];

        const c5Scores = gradedEssays
            .map(e => parseJsonSafely(e.corrections[0].content)?.competencias?.c5?.nota)
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