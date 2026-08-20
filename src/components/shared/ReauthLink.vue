<script setup lang="ts">
import { computed } from "vue";
import { useAuth } from "../../auth";
import { API } from "../../api";

// >>> only show link on own channel, admin mode would re-auth wrong account
const { session } = useAuth();
const isOwnChannel = computed(
  () => !!session.value && session.value.login === session.value.channel,
);

withDefaults(defineProps<{ fallback?: string }>(), {
  fallback: "the broadcaster needs to re-authorize",
});
</script>

<template>
  <a v-if="isOwnChannel" :href="`${API}/auth/add`" class="reauth-link"><slot /></a>
  <template v-else>{{ fallback }}</template>
</template>

<style scoped>
.reauth-link {
  color: #e5c07b;
  font-weight: 700;
  text-decoration: underline;
}
</style>
