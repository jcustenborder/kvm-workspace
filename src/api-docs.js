'use strict';
window.onload=()=>{
  window.ui=SwaggerUIBundle({
    url:'/openapi.json',dom_id:'#swagger-ui',
    presets:[SwaggerUIBundle.presets.apis,SwaggerUIStandalonePreset],
    layout:'BaseLayout',validatorUrl:null,persistAuthorization:false,
    // Use the current local origin, including localhost, for Try it out.
    responseInterceptor:response=>{
      if(response.url===new URL('/openapi.json',location.href).href && response.obj) response.obj.servers=[{url:location.origin}];
      return response;
    },
  });
};
