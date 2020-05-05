import * as SteamUser from "steam-user";
import {log} from "util";
import SteamID = require("steamid");
const SteamCommunity = require('steamcommunity');
let community = new SteamCommunity();

let user = new SteamUser() as any;

function tryLogin(details): Promise<void> {
	return new Promise((res, rej) => community.login(details, function(err) {
		if (err) {
			rej(err);
		} else {
			res();
		}
	}));
}

interface LoginDetails {
	"accountName"?: string,
	"password"?: string,
	"steamguard"?: string,
	"authCode"?: string,
	"twoFactorCode"?: string,
	"captcha"?: string,
	"disableMobile"?: boolean,
}

interface LoginToken {
	accountName: string,
	webLoginToken: string,
	steamID: SteamID
}

async function login(details: LoginDetails, steamGuard?: () => Promise<string>, twoFactor?: () => Promise<string>, captcha?: (url: string) => Promise<string>): Promise<LoginToken> {
	while (true) {
		try {
			await tryLogin(details);
			return new Promise((res, rej) => community.getClientLogonToken((err, details) => {
				if (err) {
					rej(err);
				} else {
					res(details);
				}
			}));
		} catch (e) {
			switch (e.message) {
				case 'SteamGuard':
					if (steamGuard) {
						details.steamguard = await steamGuard();
					} else {
						throw new Error("No steamguard handler provided")
					}
					break;
				case 'SteamGuardMobile':
					if (twoFactor) {
						details.twoFactorCode = await twoFactor();
					} else {
						throw new Error("No twoFactor handler provided")
					}
					break;
				case 'CAPTCHA':
					if (captcha) {
						details.captcha = await captcha(e.captchaurl);
					} else {
						throw new Error("No twoFactor handler provided")
					}
					break;
				default:
					throw e
			}
		}
	}
}

async function main() {
	let details = {
		"accountName": "icewind1991",
		"password": ""
	};
	console.log(await login(details, undefined, async () => "WM3MR"));
}

main();
