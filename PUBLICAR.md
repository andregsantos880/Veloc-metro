# Publicar na Play Store

O app já é um PWA completo (manifest, service worker, ícones). Para virar um app da Play Store sem reescrever nada, ele é empacotado como **Trusted Web Activity (TWA)**: um "casulo" Android que abre o site em tela cheia, usando o Chrome por baixo.

## Passo a passo (PWABuilder — sem instalar nada)

1. Crie a conta de desenvolvedor em https://play.google.com/console (taxa única de US$ 25).
2. Abra https://www.pwabuilder.com e informe `https://andregsantos880.github.io/Veloc-metro/`.
3. Clique em **Package for stores → Android**. Confira:
   - Package ID: `br.com.andregsantos.velocimetro` (ou outro, mas não mude depois)
   - App name: `Velocímetro Alerta`
   - Display mode: `fullscreen`
   - Marque **Signing key: create new** (guarde o `.keystore` e as senhas — sem eles não dá para atualizar o app).
4. Baixe o pacote. Dentro vem o `.aab` (envia para a loja) e o `assetlinks.json`.
5. **Importante:** copie o `assetlinks.json` para a pasta `.well-known/` deste repositório e faça push. Sem isso, o app abre com a barra do Chrome em cima.
   - Caminho final: `https://andregsantos880.github.io/Veloc-metro/.well-known/assetlinks.json`
   - O GitHub Pages serve pastas que começam com ponto normalmente; se não servir, crie um arquivo `.nojekyll` vazio na raiz.
6. No Play Console: criar app → Produção → enviar o `.aab` → preencher ficha (nome, descrição, ícone 512 px, 2+ capturas de tela, política de privacidade).
   - Política de privacidade: pode ser uma página simples dizendo que a localização é usada só no aparelho e não é enviada a nenhum servidor seu (as consultas vão para o OpenStreetMap/Overpass).
7. Classificação de conteúdo e declaração de permissões (localização em primeiro plano).

## O que a TWA resolve e o que não resolve

- **Resolve:** ícone na loja, instalação normal, tela cheia sem barra do navegador, atualizações automáticas (o conteúdo vem do GitHub Pages; não precisa reenviar o app para cada mudança).
- **Não resolve:** GPS com a tela apagada ou com outro app na frente. A TWA ainda é o Chrome, e o Chrome pausa o GPS de páginas em segundo plano. O Wake Lock mantém a tela acesa, então em uso normal no suporte do carro funciona.

## Para GPS em segundo plano de verdade

É preciso um app nativo com um plugin de localização em segundo plano. O caminho mais curto reaproveitando este código:

1. `npm init @capacitor/app` → copiar `index.html`, `app.js`, `manifest.json`, `radares-sp.json` e ícones para a pasta `www`.
2. Adicionar `@capacitor/android` e o plugin `@capacitor-community/background-geolocation`.
3. Trocar o `navigator.geolocation.watchPosition` em `app.js` por `BackgroundGeolocation.addWatcher(...)` quando estiver rodando dentro do Capacitor (detectar por `window.Capacitor`), mantendo o atual no navegador.
4. Pedir a permissão "Permitir o tempo todo" e mostrar uma notificação persistente enquanto roda (exigência do Android).

Isso é um projeto à parte (precisa de Android Studio), mas o `app.js` inteiro continua igual — só a fonte do GPS muda.
