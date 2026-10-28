'use strict';
const {readFile} = require('node:fs/promises');

async function run() {
  const report=JSON.parse(await readFile(process.argv[2] || 'investigation/private/live-lan-audio.json','utf8'));
  const [first,last]=[report.samples[0],report.samples.at(-1)];
  /** @param {object} sample @param {string} kind */
  const inbound=(sample,kind)=>sample.media.peers.flatMap(peer=>peer.stats).find(row=>row.type==='inbound-rtp' && row.kind===kind);
  const video=inbound(last,'video'), initial=inbound(first,'video'), audio=inbound(last,'audio');
  /** @param {Array<{workingSetKiB:number}>} processes */
  const mib=processes=>+(processes.reduce((sum,item)=>sum+item.workingSetKiB,0)/1024).toFixed(1);
  console.log(JSON.stringify({at:report.completedAt,scenario:report.scenario,interactiveMs:report.interactiveMs,firstFrameMs:report.firstUsableFrameMs,
    sampledSeconds:(last.elapsedMs-first.elapsedMs)/1000,decodedFps:(video.framesDecoded-initial.framesDecoded)/((last.elapsedMs-first.elapsedMs)/1000),
    decodedFrameDrops:video.framesDropped-initial.framesDropped,htmlPlaybackDrops:last.media.videos[0].dropped-first.media.videos[0].dropped,
    decoder:video.decoderImplementation,powerEfficientDecoder:video.powerEfficientDecoder,
    videoJitterBufferAverageMs:(video.jitterBufferDelay-initial.jitterBufferDelay)/(video.jitterBufferEmittedCount-initial.jitterBufferEmittedCount)*1000,
    audioJitterBufferAverageMs:audio?.jitterBufferDelay/audio?.jitterBufferEmittedCount*1000,
    incomingAudioBytes:audio?.bytesReceived,outgoingAudioBytes:last.media.peers.flatMap(peer=>peer.stats).find(row=>row.type==='outbound-rtp'&&row.kind==='audio')?.bytesSent,
    fullProcessWorkingSetMiB:mib(last.processes),afterCloseWorkingSetMiB:mib(report.afterClose),
    electronReportedCPUPercent:last.processes.reduce((sum,item)=>sum+item.cpu,0),
    note:'Working-set sum includes shared pages. Electron CPU reporting is preserved without assuming Activity Monitor normalization. RTP counters do not establish speech/echo quality or a conference call.'},null,2));
}
run().catch(error=>{console.error(error.message);process.exitCode=1;});
