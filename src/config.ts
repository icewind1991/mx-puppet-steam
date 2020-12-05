export class SteamConfigWrap {
	public steam: SteamConfig = new SteamConfig();

	public applyConfig(newConfig: { [key: string]: any }, configLayer: { [key: string]: any } = this) {
		Object.keys(newConfig).forEach((key) => {
			if (configLayer[key] instanceof Object && !(configLayer[key] instanceof Array)) {
				this.applyConfig(newConfig[key], configLayer[key]);
			} else {
				configLayer[key] = newConfig[key];
			}
		});
	}
}

class SteamConfig {
}
