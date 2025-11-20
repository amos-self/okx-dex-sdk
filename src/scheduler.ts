export class Scheduler<T> {
	private _active = false;
	private _id: NodeJS.Timeout | undefined;
	private readonly _interval: number;
	private readonly _job: () => Promise<T>;

	public constructor(job: () => Promise<T>, interval: number) {
		this._interval = interval;
		this._job = job;
	}

	public async start(): Promise<void> {
		if (!this._active) {
			this._active = true;
			return this.run();
		}
	}

	public stop(): void {
		if (this._active && this._id !== undefined) {
			clearTimeout(this._id);
			this._id = undefined;
			this._active = false;
		}
	}

	private async callJobAfterTimeout(): Promise<void> {
		return new Promise<void>(resolve => {
			this._id = setTimeout(async () => {
				await this._job();
				resolve();
			}, this._interval);
		});
	}

	private async run(): Promise<void> {
		while (this._active) {
			await this.callJobAfterTimeout();
		}
	}
}
