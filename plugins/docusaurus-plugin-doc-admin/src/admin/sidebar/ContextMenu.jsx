import React from 'react';

export class ContextMenu extends React.Component {
    constructor(props) {
        super(props);
        this.ref = React.createRef();
    }

    componentDidMount() {
        document.addEventListener('mousedown', this.handleClickOutside);
    }

    componentWillUnmount() {
        document.removeEventListener('mousedown', this.handleClickOutside);
    }

    handleClickOutside = (event) => {
        if (this.ref.current && !this.ref.current.contains(event.target)) {
            this.props.onClose();
        }
    }

    render() {
        const { x, y, items } = this.props;

        return (
            <div
                ref={this.ref}
                className="fixed z-[2000] bg-white shadow-[0_4px_12px_rgba(0,0,0,0.15)] border border-[#e8e8e8] rounded-md py-1 min-w-[160px] animate-fade-in"
                style={{ top: `${y}px`, left: `${x}px` }}
            >
                {items.map((item, index) => {
                    if (item.type === 'divider') {
                        return <div key={index} className="h-px bg-[#f0f0f0] my-1" />;
                    }
                    return (
                        <div
                            key={index}
                            className={`flex items-center px-3 py-2 cursor-pointer text-sm transition-colors duration-100 ${item.danger ? 'text-[#ff4d4f] hover:bg-[#fff1f0]' : 'text-[#333] hover:bg-[var(--admin-primary-light,#e6f7ff)]'} ${item.disabled ? 'opacity-50 !cursor-not-allowed' : ''}`}
                            onClick={() => {
                                if (!item.disabled) {
                                    item.onClick();
                                    this.props.onClose();
                                }
                            }}
                        >
                            <div className="w-5 mr-2 flex items-center justify-center">{item.icon}</div>
                            <div className="flex-1">{item.label}</div>
                        </div>
                    );
                })}
            </div>
        );
    }
}
