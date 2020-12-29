import {BBCodeField, BBCodeNode, IIncomingChatMessage, IIncomingFriendMessage} from "./interfaces";
import {Steam} from "./steam";
import UPNG from "@pdf-lib/upng";

const GIFEncoder = require("gif-encoder");
import {WritableStreamBuffer} from 'stream-buffers';
import {Util} from "mx-puppet-bridge";

function isBBCode(field: BBCodeField): field is BBCodeNode {
	return field['tag'] !== undefined;
}

async function apngToGif(sourceUrl: string): Promise<Buffer> {
	const input = await Util.DownloadFile(sourceUrl);

	const pngImage = UPNG.decode(input);
	let frameData = UPNG.toRGBA8(pngImage);

	const encoder = new GIFEncoder(pngImage.width, pngImage.height);
	let output = new WritableStreamBuffer();
	encoder.pipe(output);

	encoder.setRepeat(0);
	encoder.setTransparent(0xFF00FF);
	encoder.writeHeader();

	for (let i = 0; i < pngImage.frames.length; i++) {
		let frame = pngImage.frames[i];
		let data = new Uint8Array(frameData[i]);

		// set transparent pixels to 0xFF00FF
		for (let y = 0; y < data.length; y += 4) {
			if (data[y + 3] < 200) {
				data[y] = 0xFF;
				data[y + 1] = 0x00;
				data[y + 2] = 0xFF;
			}
		}

		encoder.setDelay(frame.delay);

		encoder.addFrame(data);
	}

	return output.getContents();
}

async function formatBBCode(steam: Steam, puppetId: number, node: BBCodeNode, message: IIncomingFriendMessage | IIncomingChatMessage): Promise<ImageMessage | TextMessage> {
	if (node.tag === 'img') {
		return {
			kind: "image",
			urlOrBuffer: node.attrs['src']
		};
	} else if (node.tag === 'emoticon') {
		let emote = node.content[0] as string;
		const mxc = await steam.getEmojiMxc(
			puppetId, 'emoticonlarge', emote,
		);
		return {
			kind: "text",
			body: `:${emote}:`,
			formattedBody: `<img alt=":${emote}:" title=":${emote}:" height="32" src="${mxc}" data-mx-emoticon />`
		};
	} else if (node.tag === 'sticker') {
		let sticker = node.attrs['type'];
		let gif = await apngToGif(`https://community.cloudflare.steamstatic.com/economy/sticker/${sticker}`);
		return {
			kind: "image",
			urlOrBuffer: gif
		};
	} else if (node.tag === 'gameinvite') {
		let game = await steam.getProduct(puppetId, node.attrs['appid']);

		if (message['local_echo']) {
			return {
				kind: "text",
				body: "",
			};
		}

		return {
			kind: "text",
			body: `You were invited to play ${game.appinfo.common.name}`
		};
	} else {
		return {kind: "text", body: message.message_no_bbcode};
	}
}

export async function exportMessageForSending(
	steam: Steam,
	puppetId: number,
	message: IIncomingFriendMessage | IIncomingChatMessage,
): Promise<(TextMessage | ImageMessage)[]> {
	if (message.message_bbcode_parsed) {
		let parts = await Promise.all(message.message_bbcode_parsed.map(node => {
			if (isBBCode(node)) {
				return formatBBCode(steam, puppetId, node, message);
			} else {
				return {kind: "text", body: node} as TextMessage;
			}
		}));

		return parts.reduce((merged, part) => {
			if (part.kind === "text" && part.body === "") {
				return merged;
			}

			if (merged.length === 0) {
				merged.push(part);
			} else {
				let last = merged[merged.length - 1];

				// merge adjacent text nodes
				if (last.kind === "text" && part.kind === "text") {
					if (!last.formattedBody) {
						last.formattedBody = last.body;
					}
					if (!part.formattedBody) {
						part.formattedBody = part.body;
					}
					last.body += " " + part.body;
					last.formattedBody += " " + part.formattedBody;
				} else {
					merged.push(part);
				}
			}
			return merged;
		}, [] as (TextMessage | ImageMessage)[]);
	} else {
		return [{kind: "text", body: message.message_no_bbcode}];
	}
}

export interface TextMessage {
	kind: "text";
	body: string;
	formattedBody?: string;
}

export interface ImageMessage {
	kind: "image";
	urlOrBuffer: string | Buffer
}
