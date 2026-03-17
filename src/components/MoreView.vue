<script setup lang="ts">
import { useI18n } from '../i18n'

const { t } = useI18n()
</script>

<template>
  <!-- shyboti.de/images to upload/edit images - images are visible on i.shyboti.de/<random_id>-->
    <div class="container">
        <h2 class="container-text">{{ t('more.images') }}</h2>
         <div class="container-icon"></div>

  <!-- shyboti.de/notes to upload notes - notes are visible on n.shyboti.de/<random_id> -->
    </div>
        <div class="container">
        <h2 class="container-text">{{ t('more.notes') }}</h2>
        <div class="container-icon"></div>

    </div>
</template>

<style scoped>
.container { background: #1a1a1e; width: 300px; height: 300px; border: 1px solid #2a2a30; padding: 18px 20px; }
.container-text { font-size: 22px; font-weight: 700; color: #e0e0e0; text-align: center;}
</style>
