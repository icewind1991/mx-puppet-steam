import SteamID from "steamid";
const SteamCommunity = require('steamcommunity');

function tryLogin(community, details): Promise<void> {
	return new Promise((res, rej) => community.login(details, function(err) {
		if (err) {
			rej(err);
		} else {
			res();
		}
	}));
}

export interface LoginDetails {
	"accountName": string,
	"password": string,
	"steamguard"?: string,
	"authCode"?: string,
	"twoFactorCode"?: string,
	"captcha"?: string,
	disableMobile?: boolean,
	rememberPassword?: boolean
}

export interface LoginToken {
	accountName: string,
	webLogonToken: string,
	steamID: SteamID
}

// export async function login(details: LoginDetails, steamGuard?: () => Promise<string>, twoFactor?: () => Promise<string>, captcha?: (urlOrBuffer: string) => Promise<string>): Promise<LoginToken> {
// 	let community = new SteamCommunity();
// 	while (true) {
// 		try {
// 			await tryLogin(details);
// 			return new Promise((res, rej) => community.getClientLogonToken((err, details) => {
// 				if (err) {
// 					rej(err);
// 				} else {
// 					res(details);
// 				}
// 			}));
// 		} catch (e) {
// 			switch (e.message) {
// 				case 'SteamGuard':
// 					if (steamGuard) {
// 						details.steamguard = await steamGuard();
// 					} else {
// 						throw new Error("No steamguard handler provided")
// 					}
// 					break;
// 				case 'SteamGuardMobile':
// 					if (twoFactor) {
// 						details.twoFactorCode = await twoFactor();
// 					} else {
// 						throw new Error("No twoFactor handler provided")
// 					}
// 					break;
// 				case 'CAPTCHA':
// 					if (captcha) {
// 						details.captcha = await captcha(e.captchaurl);
// 					} else {
// 						throw new Error("No twoFactor handler provided")
// 					}
// 					break;
// 				default:
// 					throw e
// 			}
// 		}
// 	}
// }
