import {flatten} from './imaging.js';
self.onmessage=({data:m})=>{
  try{const result=flatten(m.data,m.width,m.height,m.corners,m.mode,m.brightness,m.maxEdge);self.postMessage(result,[result.data.buffer]);}
  catch(error){self.postMessage({error:error.message});}
};
