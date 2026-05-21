import { Message, type MessageJSON } from './Message';

export interface HistoryJSON {
    messages: MessageJSON[];
}

export class History {
    private readonly messages: Message[] = [];

    get items(): readonly Message[] {
        return this.messages;
    }

    static fromJSON(json: HistoryJSON): History {
        const history = new History();
        for (const message of json.messages) {
            history.add(Message.fromJSON(message));
        }
        return history;
    }

    add(message: Message): void {
        this.messages.push(message);
    }

    pop(): Message | undefined {
        return this.messages.pop();
    }

    clear(): void {
        this.messages.length = 0;
    }

    toJSON(): HistoryJSON {
        return {
            messages: this.messages.map(message => message.toJSON()),
        };
    }
}
