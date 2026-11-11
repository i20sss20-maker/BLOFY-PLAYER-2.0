// Batch authorized Xtream catalog JSON without buffering the entire library.
// Every item still streams in order; one chunk carries up to a bounded number
// of entries, avoiding hundreds of thousands of tiny socket writes.
export function createXtreamJsonArrayWriter(write,{maxChars=65536,maxItems=128}={}){
  if(typeof write!=='function'||!Number.isSafeInteger(maxChars)||maxChars<16||
     !Number.isSafeInteger(maxItems)||maxItems<1)
    throw new TypeError('xtream_json_writer_config_invalid');
  let buffer='[',count=0,items=0,finished=false;
  return {
    append(item){
      if(finished)throw new Error('xtream_json_writer_closed');
      const serialized=JSON.stringify(item);
      if(typeof serialized!=='string')throw new TypeError('xtream_json_item_invalid');
      const next=(count++?',':'')+serialized;
      if(buffer.length+next.length>maxChars||items>=maxItems){
        const chunk=buffer;
        buffer=next;
        items=1;
        return write(chunk);
      }
      buffer+=next;
      items++;
    },
    finish(){
      if(finished)throw new Error('xtream_json_writer_closed');
      finished=true;
      const chunk=buffer+']';
      buffer='';
      return write(chunk);
    }
  };
}
