import test from 'node:test';
import assert from 'node:assert/strict';
import {automaticChanges} from '../public/conflict-values.js';

test('minimum compares numeric fields, preserves the selected original string and skips blanks or text',()=>{
 const fields=[{field:'Skill',left:'16',right:'17'},{field:'Potential',left:'18',right:'17'},{field:'Rifle',left:'0',right:'4'},{field:'Rating',left:'-1.5',right:'2.5'},{field:'Earnings',left:'',right:'100'},{field:'Name',left:'12',right:'5'},{field:'SkillBad',left:'NaN',right:'0'}];
 const result=automaticChanges(fields,'min',{numericFields:['Skill','Potential','Rifle','Rating','Earnings','SkillBad']});assert.deepEqual(result.changes,{Skill:'16',Potential:'17',Rifle:'0',Rating:'-1.5'});assert.equal(result.chosenFields,4);assert.equal(result.retainedFields,3);
});
test('random chooses A or B independently for every field, including text and intentional blanks',()=>{
 const fields=[{field:'Skill',left:'16',right:'17'},{field:'Nick',left:'A',right:'B'},{field:'Team',left:'',right:'T'}],draws=[0,0.999,0.49];let index=0;
 const result=automaticChanges(fields,'random',{random:()=>draws[index++]});assert.deepEqual(result.changes,{Skill:'16',Nick:'B',Team:''});assert.equal(index,3);assert.equal(result.chosenFields,3);assert.equal(result.retainedFields,0);assert.throws(()=>automaticChanges(fields,'unknown'));
});
