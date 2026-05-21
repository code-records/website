import React from 'react';
import { oauth2Client } from '../oauth2';

const Login = () => {
    return (
        <div className="h-screen w-screen flex items-center justify-center bg-[#f0f2f5] overflow-hidden relative">
            <div className="absolute inset-0 z-[1]">
                <div className="absolute w-[500px] h-[500px] rounded-full blur-[80px] opacity-40 animate-floating" style={{ background: 'var(--admin-primary-color)', top: '-10%', left: '-5%' }}></div>
                <div className="absolute w-[400px] h-[400px] rounded-full blur-[80px] opacity-40 animate-floating" style={{ background: 'var(--admin-primary-light)', top: '50%', right: '-10%', animationDelay: '-5s' }}></div>
                <div className="absolute w-[300px] h-[300px] rounded-full blur-[80px] opacity-40 animate-floating" style={{ background: 'var(--admin-primary-dark)', bottom: '-5%', left: '30%', animationDelay: '-10s' }}></div>
            </div>
            <div className="w-full max-w-[420px] z-10 rounded-2xl shadow-[0_20px_40px_rgba(0,0,0,0.08)] bg-white/85 backdrop-blur-[20px] border border-white/30">
                <div className="px-12 py-10 text-center">
                    <div className="mb-6">
                        <img src="/img/logo.svg" alt="Logo" className="h-16 object-contain" />
                    </div>
                    <h2 className="mb-2 font-bold text-[var(--admin-primary-color)]">文档中心管理后台</h2>
                    <p className="block mb-10 text-[#8c8c8c] text-sm">请使用您的 Gitee 账号登录以开始编辑文档</p>
                    <div>
                        <button
                            onClick={() => oauth2Client.redirectToAuth()}
                            className="flex items-center justify-center gap-2.5 w-full h-12 rounded-lg text-base font-medium text-white bg-[var(--admin-primary-color)] border-none cursor-pointer shadow-[0_4px_10px_rgba(var(--admin-primary-rgb),0.15)] transition-all duration-200 leading-none hover:-translate-y-px hover:bg-[var(--admin-primary-dark)] hover:shadow-lg"
                        >
                            <svg className="w-[22px] h-[22px]" viewBox="0 0 380 380" xmlns="http://www.w3.org/2000/svg">
                                <path d="M190.4 350.8L251.1 163.5H129.7L190.4 350.8Z" fill="#fff" />
                                <path d="M190.4 350.8L129.7 163.5H18.1L190.4 350.8Z" fill="rgba(255,255,255,0.8)" />
                                <path d="M18.1 163.5L1.5 214.6C0 219.2 1.5 224.3 5.4 227.1L190.4 350.8L18.1 163.5Z" fill="rgba(255,255,255,0.6)" />
                                <path d="M18.1 163.5H129.7L82.4 17.8C80.5 12.1 72.6 12.1 70.7 17.8L18.1 163.5Z" fill="#fff" />
                                <path d="M190.4 350.8L251.1 163.5H362.7L190.4 350.8Z" fill="rgba(255,255,255,0.8)" />
                                <path d="M362.7 163.5L379.3 214.6C380.8 219.2 379.3 224.3 375.4 227.1L190.4 350.8L362.7 163.5Z" fill="rgba(255,255,255,0.6)" />
                                <path d="M362.7 163.5H251.1L298.4 17.8C300.3 12.1 308.2 12.1 310.1 17.8L362.7 163.5Z" fill="#fff" />
                            </svg>
                            使用 Gitee 登录
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Login;
