import * as fs from 'fs/promises';
import * as path from 'path';
import { Model, type ModelEvent, type ModelRequest, type ModelResponseStatus } from './model/Model';
import { Agent } from './Agent';
import { Message } from './chat/Message';
import { ToolRunContext } from './tools/tool/Tool';
import { FileTool, type FileToolInput, type FileToolOutput } from './tools/FileTool';

// ─── 1. Mock 大语言模型 ──────────────────────────────────
class MockModel extends Model {
    private isFirstRound = true;

    constructor() {
        super({ url: 'http://mock-api', model: 'mock-agent-model' });
    }

    async *stream(request: ModelRequest): AsyncGenerator<ModelEvent, void, void> {
        // 第一轮：触发工具调用，只读 package.json
        if (this.isFirstRound) {
            this.isFirstRound = false;
            yield {
                type: 'action',
                action: {
                    type: 'tool',
                    call: { id: 'call_1', name: 'file', input: { operation: 'read', path: 'package.json' } }
                },
                kind: 'add'
            };
            yield {
                type: 'done',
                response: {
                    actions: [{ type: 'tool', call: { id: 'call_1', name: 'file', input: { operation: 'read', path: 'package.json' } } }],
                    content: '正在为您读取 package.json 文件...',
                    status: 'tool'
                }
            };
        } else {
            // 第二轮（收到读取结果后）：生成最终回答并展示文件前 150 个字符
            const lastMessage = request.messages[request.messages.length - 1];
            const actionItems = lastMessage.plan?.items.flatMap(round => round.items) ?? [];
            console.log('\n🔍 [调试信息] actionItems 数组:', JSON.stringify(actionItems, null, 2));
            const fileActionResult = actionItems.find(item => item.type === 'tool' && item.done);
            const fileContent = fileActionResult?.content ?? '未读取到内容';

            const reply = `[测试成功] File工具已成功读取 package.json。内容预览（前120字符）:\n\n${fileContent.slice(0, 120)}...`;
            yield { type: 'message_delta', content: reply };
            yield {
                type: 'done',
                response: {
                    actions: [],
                    content: reply,
                    status: 'final'
                }
            };
        }
    }

    protected resolveStatus(): ModelResponseStatus { return 'final'; }
    protected async request(): Promise<any> { return {}; }
    protected async *requestStream(): AsyncGenerator<any> { }
    protected expandMessageToProviderMessages(): any[] { return []; }
    protected expandToolAskToProviderMessages(): any[] { return []; }
}

// ─── 2. 实现 FileTool 的真实只读具体子类 ───────────────────
class TestFileTool extends FileTool {
    protected async executeFileOperation(input: FileToolInput, _context: ToolRunContext): Promise<FileToolOutput> {
        if (input.operation !== 'read') {
            throw new Error(`[TestFileTool] 本次测试仅允许 'read' 只读操作，不允许 '${input.operation}' 写入/修改等副作用操作。`);
        }

        // 将相对路径解析为当前 Node 进程执行目录（即 website 根目录）的绝对路径
        const absolutePath = path.resolve(process.cwd(), input.path);

        try {
            // 真实读取本地 package.json
            const content = await fs.readFile(absolutePath, 'utf-8');
            return {
                operation: 'read',
                path: input.path,
                content: content
            };
        } catch (error: any) {
            throw new Error(`读取本地文件失败: ${error.message}`);
        }
    }
}

// ─── 3. 构造测试 Agent 实例 ──────────────────────────────
class TestAgent extends Agent {
    name = 'TestFileAgent';
    systemPrompt = '你是一个用于测试 File 只读工具的测试助手。';
    model = new MockModel();

    constructor() {
        super({
            maxRounds: 5
        });
        // 绑定我们的真实只读 FileTool 实现
        this.tools = [new TestFileTool()];
    }
}

// ─── 4. 执行异步测试回路 ────────────────────────────────
async function runAgentTest() {
    console.log('================================================');
    console.log('🚀 开始执行 File 只读工具核心回路测试...');
    console.log('================================================\n');

    const agent = new TestAgent();

    // 核心前置断言：Message 树的尾部必须是一个激活的 assistant 角色消息
    const activeAssistantMessage = Message.assistant();

    const messages = [
        Message.user('分析当前工作目录的架构'),
        activeAssistantMessage
    ];

    try {
        // 流式执行，驱动 AsyncGenerator 并阻塞直到全部跑完
        for await (const event of agent.run({ messages })) {
            console.log(`🔔 [收到事件] 类型: ${event.type}`);

            if (event.type === 'model_event') {
                console.log(`   └─ 模型事件细分: ${event.event.type}`);
                if (event.event.type === 'thinking_delta' || event.event.type === 'message_delta') {
                    console.log(`   └─ 模型文本增量: "${event.event.content}"`);
                }
            } else if (event.type === 'tool_start') {
                console.log(`   ├─ 🔨 [FileTool] 开始读取: ${event.tool} (ID: ${event.callId})`);
            } else if (event.type === 'tool_done') {
                console.log(`   ├─ ✅ [FileTool] 读取成功: ${event.tool} (ID: ${event.callId})`);
            } else if (event.type === 'agent_done') {
                console.log('\n================================================');
                console.log('🎉 File 只读工具核心测试回路顺利跑通！');
                console.log(`最终模型回答:\n\n${event.response?.content}`);
                console.log('================================================');
            }
        }
    } catch (error) {
        console.error('\n❌ 测试执行中发生异常:', error);
    }
}

// 启动测试
// npx tsx "$pwd/test.ts"
runAgentTest();
