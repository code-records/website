import { Step } from './Step';
import { Round, type RoundJSON } from './Round';
import type { AgentEvent, ClientStatus } from './type';

export interface AgentResultJSON {
    kind?: 'agent_result';
    rounds: RoundJSON[];
    status: ClientStatus;
}

export class AgentResult {
    readonly kind = 'agent_result';
    status: ClientStatus = 'pending';
    private readonly _rounds: Round[] = [];

    get rounds(): readonly Round[] {
        return this._rounds;
    }

    get content(): string {
        return this._rounds
            .filter(round => round.type === 'final' || round.type === 'continue')
            .map(round => round.text)
            .filter(text => text.length > 0)
            .join('');
    }

    static fromJSON(json: AgentResultJSON): AgentResult {
        const result = new AgentResult();
        result.status = json.status;
        for (const round of json.rounds) {
            result._rounds.push(Round.fromJSON(round));
        }
        return result;
    }

    apply(event: AgentEvent): Round | null {
        if (event.type === 'agent_error') {
            const round = this.ensureRound();
            const step = Step.fromAgentEvent(event) as Step;
            round.add(step);
            this.status = 'failed';
            this.failOpenRound();
            return round;
        }

        if (event.type === 'agent_done') {
            this.status = 'completed';
            this.completeOpenRound();
            return this.currentRound ?? null;
        }

        if (event.type === 'model_event' && event.event.type === 'content') {
            const round = this.ensureModelRound();
            round.appendText(event.event.content);
            return round;
        }

        if (event.type === 'model_event' && event.event.type === 'done') {
            const round = this.ensureModelRound();
            round.type = event.event.response.responseStatus;
            return round;
        }

        const step = Step.fromAgentEvent(event);
        if (step === null) return null;

        const round = event.type === 'model_event' ? this.ensureModelRound() : this.ensureRound();
        if (step.type === 'tool') {
            if (round.updateTool(step)) return round;
            round.add(step);
            return round;
        }
        if (event.type === 'model_event' && event.event.type === 'action' && event.event.kind === 'update') {
            if (round.updateLast(step)) return round;
        }
        if (step.type === 'thinking' && round.appendToLast(step.type, step.text)) {
            return round;
        }
        round.add(step);
        return round;
    }

    complete(): void {
        this.status = 'completed';
        this.completeOpenRound();
    }

    fail(): void {
        this.status = 'failed';
        this.failOpenRound();
    }

    toJSON(): AgentResultJSON {
        return {
            kind: this.kind,
            status: this.status,
            rounds: this._rounds.map(round => round.toJSON()),
        };
    }

    private get currentRound(): Round | undefined {
        return this._rounds[this._rounds.length - 1];
    }

    private ensureRound(): Round {
        const last = this.currentRound;
        if (last !== undefined && last.status === 'pending') {
            return last;
        }
        const round = new Round();
        this._rounds.push(round);
        return round;
    }

    private ensureModelRound(): Round {
        const last = this.currentRound;
        if (last !== undefined && last.status === 'pending' && last.type !== undefined) {
            last.complete();
        }
        return this.ensureRound();
    }

    private completeOpenRound(): void {
        const last = this.currentRound;
        if (last !== undefined) {
            last.complete();
        }
    }

    private failOpenRound(): void {
        const last = this.currentRound;
        if (last !== undefined) {
            last.fail();
        }
    }
}
