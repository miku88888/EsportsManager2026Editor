import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {discoverInstall,saveConfiguration} from '../lib/setup.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
try{
 if(process.argv[2]==='discover')console.log(JSON.stringify(discoverInstall(process.argv.slice(3))));
 else if(process.argv[2]==='save'){const parts=[];for await(const bytes of process.stdin)parts.push(bytes);saveConfiguration(JSON.parse(Buffer.concat(parts).toString('utf8').replace(/^\ufeff/,'')),root);console.log('配置已保存');}
 else throw Error('用法：configure.mjs discover 或 save（从标准输入读取 JSON）');
}catch(error){console.error(error.message);process.exitCode=1;}
