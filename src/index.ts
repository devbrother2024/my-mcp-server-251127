import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { InferenceClient } from '@huggingface/inference'

// Create server instance
const server = new McpServer({
    name: 'greeting-server',
    version: '1.0.0',
    capabilities: {
        tools: {}
    }
})

// Hugging Face Inference Client 초기화
const hfClient = new InferenceClient(process.env.HF_TOKEN || '')

// Blob을 base64로 변환하는 헬퍼 함수
async function blobToBase64(blob: Blob): Promise<string> {
    const arrayBuffer = await blob.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    return buffer.toString('base64')
}

// 언어별 인사말 정의
const greetings: Record<string, (name: string) => string> = {
    ko: name => `안녕하세요, ${name}님! 만나서 반갑습니다.`,
    en: name => `Hello, ${name}! Nice to meet you.`,
    ja: name => `こんにちは、${name}さん！はじめまして。`,
    zh: name => `你好，${name}！很高兴认识你。`,
    es: name => `¡Hola, ${name}! Encantado de conocerte.`,
    fr: name => `Bonjour, ${name} ! Enchanté de vous rencontrer.`,
    de: name => `Hallo, ${name}! Freut mich, Sie kennenzulernen.`
}

// greeting 도구 등록
server.tool(
    'greeting',
    '사용자의 이름과 언어를 입력받아 해당 언어로 인사말을 반환합니다.',
    {
        name: z.string().describe('인사할 사용자의 이름'),
        language: z
            .enum(['ko', 'en', 'ja', 'zh', 'es', 'fr', 'de'])
            .describe(
                '인사말 언어 (ko: 한국어, en: 영어, ja: 일본어, zh: 중국어, es: 스페인어, fr: 프랑스어, de: 독일어)'
            )
    },
    async ({ name, language }) => {
        const greetingFn = greetings[language]
        const message = greetingFn(name)

        return {
            content: [
                {
                    type: 'text',
                    text: message
                }
            ]
        }
    }
)

// calc 도구 등록
server.tool(
    'calc',
    '두 개의 숫자와 연산자를 입력받아 계산 결과를 반환합니다.',
    {
        a: z.number().describe('첫 번째 숫자'),
        b: z.number().describe('두 번째 숫자'),
        operator: z
            .enum(['+', '-', '*', '/'])
            .describe('연산자 (+: 덧셈, -: 뺄셈, *: 곱셈, /: 나눗셈)')
    },
    async ({ a, b, operator }) => {
        let result: number

        switch (operator) {
            case '+':
                result = a + b
                break
            case '-':
                result = a - b
                break
            case '*':
                result = a * b
                break
            case '/':
                if (b === 0) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: '오류: 0으로 나눌 수 없습니다.'
                            }
                        ],
                        isError: true
                    }
                }
                result = a / b
                break
        }

        return {
            content: [
                {
                    type: 'text',
                    text: `${a} ${operator} ${b} = ${result}`
                }
            ]
        }
    }
)

// getCurrentTime 도구 등록
server.tool(
    'getCurrentTime',
    '타임존을 입력받아 해당 타임존의 현재 시간을 반환합니다.',
    {
        timezone: z
            .string()
            .describe(
                'IANA 타임존 형식 (예: Asia/Seoul, America/New_York, Europe/London, UTC 등)'
            )
    },
    async ({ timezone }) => {
        try {
            const now = new Date()
            const formatter = new Intl.DateTimeFormat('ko-KR', {
                timeZone: timezone,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            })

            const formattedTime = formatter.format(now)
            const timeZoneName =
                new Intl.DateTimeFormat('ko-KR', {
                    timeZone: timezone,
                    timeZoneName: 'long'
                })
                    .formatToParts(now)
                    .find(part => part.type === 'timeZoneName')?.value ||
                timezone

            return {
                content: [
                    {
                        type: 'text',
                        text: `${timezone}의 현재 시간: ${formattedTime} (${timeZoneName})`
                    }
                ]
            }
        } catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `오류: 유효하지 않은 타임존입니다. (${timezone})`
                    }
                ],
                isError: true
            }
        }
    }
)

// 가짜 서버 정보 리소스 등록
server.resource(
    'fake-server-info',
    'server://fake-info',
    {
        name: '가짜 서버 정보',
        description: '테스트용 가짜 서버 상태를 반환합니다.',
        mimeType: 'application/json'
    },
    async () => {
        const now = new Date()
        const info = {
            id: 'srv-demo-001',
            name: 'Demo Application Server',
            region: 'ap-northeast-2',
            status: 'healthy',
            uptimeSeconds: 86_400,
            activeConnections: 128,
            cpuUsage: 37,
            memoryUsage: 58,
            lastDeployment: new Date(now.getTime() - 3_600_000).toISOString(),
            reportedAt: now.toISOString()
        }

        return {
            contents: [
                {
                    uri: 'server://fake-info',
                    mimeType: 'application/json',
                    text: JSON.stringify(info, null, 2)
                }
            ]
        }
    }
)

// code_review 프롬프트 등록
server.prompt(
    'code_review',
    '사용자가 제공한 코드 스니펫을 리뷰하기 위한 프롬프트를 생성합니다.',
    {
        language: z
            .string()
            .optional()
            .describe('코드 언어 (예: TypeScript, Python 등)'),
        code: z.string().describe('리뷰할 코드 스니펫')
    },
    async ({ language, code }) => {
        const languageLabel = language ? `${language}` : '제공된'
        const promptText = [
            `${languageLabel} 코드에 대한 종합적인 코드 리뷰를 작성하세요.`,
            '',
            '요구 사항:',
            '1. 잠재적인 버그나 예외 상황을 우선적으로 지적할 것',
            '2. 성능, 보안, 가독성, 테스트 관점에서 개선점을 제안할 것',
            '3. 근거가 필요한 경우 간단한 코드 조각을 제시할 것',
            '',
            '코드:',
            '```',
            code,
            '```'
        ].join('\n')

        return {
            description: '코드 리뷰를 위한 사용자 메시지',
            messages: [
                {
                    role: 'user' as const,
                    content: {
                        type: 'text' as const,
                        text: promptText
                    }
                }
            ]
        }
    }
)

// generateImage 도구 등록
server.tool(
    'generateImage',
    '텍스트 프롬프트를 입력받아 AI로 이미지를 생성합니다.',
    {
        prompt: z.string().describe('이미지 생성을 위한 텍스트 프롬프트')
    },
    async ({ prompt }) => {
        try {
            // HF_TOKEN이 없으면 에러 반환
            if (!process.env.HF_TOKEN) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: '오류: HF_TOKEN 환경 변수가 설정되지 않았습니다.'
                        }
                    ],
                    isError: true
                }
            }

            // Hugging Face Inference API로 이미지 생성
            const imageResult = await hfClient.textToImage({
                provider: 'auto',
                model: 'black-forest-labs/FLUX.1-schnell',
                inputs: prompt,
                parameters: { num_inference_steps: 5 }
            })

            // Blob인지 확인하고 base64로 변환
            let base64Data: string
            let mimeType: string

            // 타입 가드: Blob인지 확인
            const isBlob = (value: unknown): value is Blob => {
                return (
                    typeof value === 'object' &&
                    value !== null &&
                    'arrayBuffer' in value &&
                    'type' in value &&
                    typeof (value as Blob).arrayBuffer === 'function'
                )
            }

            if (isBlob(imageResult)) {
                base64Data = await blobToBase64(imageResult)
                mimeType = imageResult.type || 'image/png'
            } else if (typeof imageResult === 'string') {
                // 이미 base64 문자열이거나 URL인 경우
                // URL인 경우 fetch로 가져와야 하지만, 일단 base64로 가정
                base64Data = imageResult
                mimeType = 'image/png'
            } else {
                throw new Error('예상치 못한 이미지 형식입니다.')
            }

            return {
                content: [
                    {
                        type: 'image',
                        data: base64Data,
                        mimeType: mimeType
                    }
                ],
                annotations: {
                    audience: ['user'],
                    priority: 0.9
                }
            }
        } catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `오류: 이미지 생성 중 오류가 발생했습니다. ${
                            (error as Error).message
                        }`
                    }
                ],
                isError: true
            }
        }
    }
)

// 서버 시작
async function main() {
    const transport = new StdioServerTransport()
    await server.connect(transport)
    console.error('MCP Server running on stdio')
}

main().catch(console.error)
