import React from 'react';
import { Flow } from '../../../agent';

const WELCOME_MESSAGE = '你好！我是 CodeAgent 极客编程助手。我已经搭载了物理文件读写工具，授权连接本地代码库后，我可以直接读取、诊断并物理重写你工作区下的代码，让我们开始吧！';

const SDK_INTEGRATION_FLOWS = [
    {
        label: '[1/7] 引入 SDK 到游戏项目',
        input: [
            '当前步骤用于指导用户将 SDK 引入到游戏项目中。',
            '请先说明可选接入方式：A. npm / pnpm / yarn 项目执行 npm install @demo/game-sdk；B. Unity 项目导入 GameSDK.unitypackage；C. 原生项目将 sdk 目录复制到 libs 或 plugins 目录。',
            '用户输入 done 后，先读取项目代码并检查 SDK 是否已经完成引入。',
            '检查通过时输出类似结果：已检测到 SDK 依赖、当前项目类型、SDK 版本，然后进入下一步。',
            '如果未通过，请指出缺失的依赖或引用位置，并提示用户修正后输入 check 重新检查。',
        ].join('\n'),
    },
    {
        label: '[2/7] 配置参数',
        input: [
            '当前步骤用于指导用户创建 SDK 配置参数并获取对应功能插件包。',
            '请提示用户打开“SDK参数获取页面”，输入项目ID和包ID进行配置获取。',
            '用户输入 done 后，读取项目代码并校验配置文件是否存在，例如 sdk.config.ts、sdk.config.js 或项目已有配置入口。',
            '重点检查 appId、channelId、env、debug 等字段是否存在，避免硬编码敏感信息。',
            '检查通过后，输出配置文件和关键字段检测结果，并开始推荐初始化调用时机和示例代码。',
            '如果配置缺失，请列出缺失字段和建议文件位置，并提示用户输入 check 重新检查。',
        ].join('\n'),
    },
    {
        label: '[3/7] 调用初始化接口',
        input: [
            '当前步骤用于指导用户在游戏启动入口调用 SDK 初始化接口。',
            '请推荐初始化位置：Web 项目使用 main.ts / index.ts；Unity 项目使用游戏启动脚本 Start 方法；原生项目使用 Application / Activity 初始化阶段。',
            '请展示初始化示例代码，包含 GameSDK.init、sdkConfig.appId、sdkConfig.channelId、sdkConfig.env、sdkConfig.debug。',
            '提醒用户初始化接口只调用一次，并且必须在登录、支付、上报之前完成。',
            '用户输入 done 后，读取项目代码并检查是否存在 GameSDK.init 调用、初始化位置是否合理、是否重复初始化。',
            '正常情况输出检查通过项。异常情况请明确指出：未检测到初始化调用、初始化位置可能不正确、初始化参数可能缺失，并提示用户输入 check 重新检查。',
        ].join('\n'),
    },
    {
        label: '[4/7] 登录接入',
        input: [
            '当前步骤用于指导用户接入 SDK 登录能力。',
            '请先读取项目代码，分析现有账号、认证、用户状态或登录入口。',
            '引导用户将 SDK 登录能力接入到登录链路中，并处理成功、失败、取消、token 保存和状态同步。',
            '用户输入 done 后，检查是否存在 SDK 登录调用、登录结果处理、错误处理和用户状态同步。',
            '检查通过时输出已检测到登录接入的关键路径。异常时列出缺失点，并提示用户输入 check 重新检查。',
        ].join('\n'),
    },
    {
        label: '[5/7] 支付接入',
        input: [
            '当前步骤用于指导用户接入 SDK 支付能力。',
            '请先定位项目中的支付入口、商品下单、订单创建和支付结果处理流程。',
            '引导用户接入 SDK 支付接口，并处理订单参数、支付结果回调、失败重试、取消支付和服务端结果校验。',
            '用户输入 done 后，检查是否存在 SDK 支付调用、订单参数传递和支付结果处理。',
            '检查通过时输出支付链路检测结果。异常时列出缺失点和建议修正位置，并提示用户输入 check 重新检查。',
        ].join('\n'),
    },
    {
        label: '[6/7] 数据上报',
        input: [
            '当前步骤用于指导用户接入 SDK 数据上报能力。',
            '请先梳理关键业务事件和生命周期事件，例如启动、登录成功、创建角色、进入游戏、支付发起、支付成功、关卡或核心玩法事件。',
            '引导用户保证事件命名、参数结构和触发时机稳定。',
            '用户输入 done 后，检查项目中是否存在 SDK 上报调用、关键事件覆盖和必要参数。',
            '检查通过时输出上报事件覆盖情况。异常时列出缺失事件或参数，并提示用户输入 check 重新检查。',
        ].join('\n'),
    },
    {
        label: '[7/7] 接入验证',
        input: [
            '当前步骤用于完成 SDK 接入验证。',
            '请检查前六步是否完整：SDK 引入、配置参数、初始化、登录、支付、数据上报。',
            '补充必要的验证步骤、测试用例或自检清单，确认初始化、登录、支付和上报链路可用。',
            '用户输入 done 后，读取项目代码并进行最终检查。',
            '检查通过时输出接入完成结论和后续测试建议。异常时按步骤列出仍未完成的问题，并提示用户输入 check 重新检查。',
        ].join('\n'),
    },
];

const TROUBLESHOOT_FLOWS = [
    {
        label: '[1/3] 收集问题上下文',
        input: '当前步骤只负责收集和理解问题上下文。请读取必要日志、报错、配置和相关源码，明确问题现象、复现路径和影响范围，先不要修改文件。',
    },
    {
        label: '[2/3] 定位并修复问题',
        input: '当前步骤负责定位根因并执行最小必要修复。修改前必须读取原文件，说明修复思路，避免无关重构。',
    },
    {
        label: '[3/3] 验证修复结果',
        input: '当前步骤负责验证修复结果。请运行相关检查、构建或测试；如果无法运行，请说明原因，并总结修复内容和剩余风险。',
    },
];

function createFlows(flowSpecs) {
    return flowSpecs.map(spec => new Flow(spec));
}

export default function CodeWelcome({ chat, disabled = false, onFlowStart }) {
    const runFlow = async (flowSpecs) => {
        if (!chat || chat.isSending) return;
        onFlowStart?.();
        await chat.runFlows(createFlows(flowSpecs));
    };

    return (
        <div className="flex flex-col items-center gap-4 text-center max-w-xl pointer-events-auto">
            <div className="w-12 h-12 rounded-xl bg-[var(--ifm-color-primary-lightest)] border border-[var(--ifm-color-primary-light)] flex items-center justify-center text-[var(--ifm-color-primary)]">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <polyline points="16 18 22 12 16 6" />
                    <polyline points="8 6 2 12 8 18" />
                </svg>
            </div>

            <div className="grid gap-2">
                <h3 className="text-sm font-bold text-[var(--ifm-font-color-base)] tracking-widest m-0 uppercase">CodeAgent Terminal</h3>
                <p className="text-xs text-[var(--ifm-color-emphasis-600)] leading-relaxed m-0">{WELCOME_MESSAGE}</p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                    type="button"
                    disabled={disabled}
                    onClick={() => runFlow(SDK_INTEGRATION_FLOWS)}
                    className="h-9 rounded-md border border-[var(--ifm-color-primary)] bg-[var(--ifm-color-primary)] px-3 text-xs font-semibold text-white cursor-pointer transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    SDK 接入
                </button>
                <button
                    type="button"
                    disabled={disabled}
                    onClick={() => runFlow(TROUBLESHOOT_FLOWS)}
                    className="h-9 rounded-md border border-[var(--ifm-color-emphasis-300)] bg-[var(--ifm-background-color)] px-3 text-xs font-semibold text-[var(--ifm-font-color-base)] cursor-pointer transition-colors hover:bg-[var(--ifm-color-emphasis-100)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                    问题排查
                </button>
            </div>
        </div>
    );
}
